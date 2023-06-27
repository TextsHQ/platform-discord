import { texts } from '@textshq/platform-sdk'
import type { ClientRequest, IncomingMessage } from 'http'
import WebSocket from 'ws'
import { SUPER_PROPERTIES } from '@/discord-constants'
import type { Packer } from '@/packers'
import { MessageType, CloseCode, ConnectionOptions, OPCode } from './types'
import type { Message } from './types'
import { WSError } from './errors'
import { DEBUG } from '@'
import { UserPresenceStatus } from '@/types/Discord'

const LOG_PREFIX = '[discord ws]'

// TODO: Use resume url from READY

export class GatewayClient {
  url: string

  private readonly token: string

  private readonly packer: Packer

  private readonly options: ConnectionOptions

  private ws?: WebSocket

  private sessionID?: string

  private lastSequenceNumber?: number

  private heartbeatTimer?: NodeJS.Timer

  private heartbeatTimeout?: NodeJS.Timeout

  private receivedHeartbeatAck?: boolean

  private _ready = false

  public get ready(): boolean {
    return this._ready && this.ws?.readyState === WebSocket.OPEN
  }

  /// Should connection be resumed after connecting?
  shouldResume = false

  public onMessage?: (message: Message<any>) => void

  public onChangedReadyState?: (ready: boolean) => void

  public onError?: (error: Error) => void

  public onConnectionClosed?: (code: number, reason?: string) => void

  constructor(url: string, token: string, packer: Packer, options: ConnectionOptions) {
    this.url = url
    this.token = token
    this.packer = packer
    this.options = options
  }

  public connect = () => {
    if (this.ready || (this.ws?.readyState === WebSocket.CONNECTING) || this.ws?.readyState === WebSocket.OPEN) {
      console.log(LOG_PREFIX, `Attempted to connect, but is already ready/connecting, ready: ${this.ready}, state: ${this.ws?.readyState}`)
      return
    }

    const urlParts = {
      v: this.options.version.toString(),
      encoding: this.options.encoding.toString(),
      // compress: this.options.compress?.toString() ?? ''
    }
    const urlParams = new URLSearchParams(urlParts)
    const gatewayURL = `${this.url}?${urlParams.toString()}`
    console.log(LOG_PREFIX, 'Opening WebSocket, URL:', gatewayURL)
    this.ws = new WebSocket(gatewayURL)
    this.setupHandlers()
  }

  public disconnect = (code: number = CloseCode.ManualDisconnect) => {
    console.log(LOG_PREFIX, `Disconnect called with code ${code}`)
    clearInterval(this.heartbeatTimer!)
    clearTimeout(this.heartbeatTimeout!)
    this.ws?.close(code)
  }

  public send = async <M>(message: Message<M>) => {
    if (DEBUG) console.log('<', message)

    if (this.ws?.readyState !== WebSocket.OPEN) {
      texts.error(LOG_PREFIX, `Attempted to send, but ws isn't ready: readyState: ${this.ws?.readyState}.`)
      throw WSError.wsNotReady
    }
    const packed = this.packer.pack(message)
    this.ws.send(packed)
  }

  private setupHandlers = () => {
    if (!this.ws) {
      texts.error(LOG_PREFIX, 'Called setupHandlers(), but there\'s no ws!')
      throw WSError.wsNotReady
    }

    this.ws.on('open', this.wsOpen)
    this.ws.on('close', this.wsClose)
    this.ws.on('message', this.wsMessage)
    this.ws.on('error', this.wsError)
    this.ws.on('unexpected-response', this.wsUnexpectedResponse)
  }

  private wsOpen = () => {
    console.log(LOG_PREFIX, 'WebSocket open!')
    this._ready = true
  }

  private wsClose = (code: CloseCode, reason: string) => {
    console.log(LOG_PREFIX, `WebSocket closed, code: ${code}, reason: ${reason}.`)
    this._ready = false
    clearInterval(this.heartbeatTimer!)

    if (code === CloseCode.ReconnectRequested) {
      this.shouldResume = true
      this.disconnect(CloseCode.ReconnectRequested)
      this.connect()
      return
    }

    this.onConnectionClosed?.(code, reason)
  }

  private wsMessage = (data: WebSocket.Data) => {
    try {
      const unpacked = this.packer.unpack(data) as Message<any>
      if (!unpacked) throw WSError.errorUnpacking
      this.handleMessage(unpacked)
    } catch (e) {
      texts.error(LOG_PREFIX, 'Error unpacking', e, data)
      this.onError?.(e as Error)
    }
  }

  private handleMessage = (message: Message<any>) => {
    if (DEBUG) console.log('>', message)

    if (message.s) {
      const expectedSequenceNumber = (this.lastSequenceNumber ?? 0) + 1
      if (message.s !== expectedSequenceNumber) texts.error(LOG_PREFIX, `Sequence # mismatch! Expected: ${expectedSequenceNumber}, got: ${message.s}.`)

      this.lastSequenceNumber = message.s
    }

    switch (message.op) {
      case OPCode.Dispatch:
        this.handleDispatch(message)
        break
      case OPCode.Heartbeat:
        this.sendHeartbeat()
        break
      case OPCode.Reconnect:
      case OPCode.InvalidSession:
        console.log(LOG_PREFIX, `OP: ${message.op}, reconnecting...`)
        this._ready = false
        this.shouldResume = true
        this.disconnect(CloseCode.ManualDisconnect)
        this.connect()
        break
      case OPCode.Hello:
        this.setupHeartbeat(message.d.heartbeat_interval)
        this.sendIdentifyOrResume()
        this.shouldResume = false
        break
      case OPCode.HearbeatAck: {
        if (DEBUG) console.log(LOG_PREFIX, 'Got HEARTBEAT_ACK!')
        this.receivedHeartbeatAck = true
        break
      }

      // * Send-only
      /*
      case OPCode.Identify:
      case OPCode.PresenceUpdate:
      case OPCode.VoiceStateUpdate:
      case OPCode.Resume:
      case OPCode.RequestGuildMembers: {
        // Shouldn't ever happen
        console.log(LOG_PREFIX, `Received send-only OPCode (${message.op})!`, message)
        break
      }
      */

      // * Default

      default: {
        console.log(LOG_PREFIX, `Unhandled OPCode (${message.op})!`, message)
        break
      }
    }

    this.onMessage?.(message)
  }

  private setupHeartbeat = (interval: number) => {
    if (DEBUG) console.log(LOG_PREFIX, `Setting heartbeat interval to ${interval}`)

    const jitter = Math.random()
    clearTimeout(this.heartbeatTimeout!)
    this.heartbeatTimeout = setTimeout(() => {
      this.receivedHeartbeatAck = true
      this.sendHeartbeat()
      clearInterval(this.heartbeatTimer!)
      this.heartbeatTimer = setInterval(this.sendHeartbeat, interval)
    }, interval + jitter)
  }

  private sendIdentifyOrResume = () => {
    // ? Resuming returns `d: false`
    // this.shouldResume = false

    if (DEBUG) console.log(LOG_PREFIX, this.shouldResume ? 'Resuming...' : 'Sending identify...')

    let payload: Message<any>
    if (this.shouldResume) {
      payload = {
        op: OPCode.Resume,
        d: {
          token: this.token,
          session_id: this.sessionID,
          seq: this.lastSequenceNumber,
        },
      }
    } else {
      payload = {
        op: OPCode.Identify,
        d: {
          token: this.token,
          capabilities: 8189, // sniffed
          properties: SUPER_PROPERTIES,
          presence: {
            status: UserPresenceStatus.Online,
            since: 0,
            activities: [],
            afk: false,
          },
          compress: false,
          client_state: {
            guild_versions: {},
            highest_last_message_id: '0',
            read_state_version: 0,
            user_guild_settings_version: -1,
            user_settings_version: -1,
            private_channels_version: '0',
            api_code_version: 0,
          },
        },
      }
    }

    this.send(payload)
  }

  private sendHeartbeat = () => {
    if (DEBUG) console.log(LOG_PREFIX, 'Sending heartbeat...')

    if (!this.receivedHeartbeatAck) {
      // TODO: Check this - connection zombified, https://discord.com/developers/docs/topics/gateway#heartbeating
      console.log(LOG_PREFIX, 'Connection zombified')
      this.shouldResume = true
      this.disconnect(CloseCode.ReconnectRequested)
      this.connect()
      return
    }

    const payload: Message<number> = {
      op: OPCode.Heartbeat,
      d: this.lastSequenceNumber,
    }
    this.send(payload)
    this.receivedHeartbeatAck = false
  }

  private handleDispatch = (message: Message<any>) => {
    switch (message.t) {
      case MessageType.Ready: {
        if (DEBUG) console.log(LOG_PREFIX, 'Got dispatch <READY>!')
        this.sessionID = message.d?.session_id
        break
      }

      case MessageType._SessionsReplace: {
        const session = message.d?.[0]
        if (session.session_id) this.sessionID = session.session_id
        break
      }

      case MessageType.Resumed: {
        const presencePayload = {
          op: OPCode.PresenceUpdate,
          d: {
            status: UserPresenceStatus.Online,
            since: null,
            activities: [],
            afk: false,
          },
        }
        this.send(presencePayload)
        break
      }

      default:
        break
    }
  }

  // eslint-disable-next-line class-methods-use-this
  private wsError = (err: Error) => {
    if (DEBUG) console.log(LOG_PREFIX, `WebSocket error: ${err}`)
  }

  // eslint-disable-next-line class-methods-use-this
  private wsUnexpectedResponse = (request: ClientRequest, response: IncomingMessage) => {
    if (DEBUG) console.log(LOG_PREFIX, 'WebSocket unexpected response!', request, response)
  }
}
