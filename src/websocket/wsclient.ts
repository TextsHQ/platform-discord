import { texts } from '@textshq/platform-sdk'
import type { ClientRequest, IncomingMessage } from 'http'
import WebSocket from 'ws'
import { SUPER_PROPERTIES } from '../discord-constants'
import type { Packer } from '../packers'
import { DEBUG } from '../preferences'
import { DiscordPresenceStatus, GatewayCloseCode, GatewayMessageType, OPCode } from './constants'
import { WSError } from './errors'
import type { GatewayConnectionOptions, GatewayMessage } from './types'

const LOG_PREFIX = '[discord ws]'

/*
    * Reconnecting with IDENTIFY
    + Works
    - We don't know about skipped events

    * Reconnecting with RESUME
    ? how
    ? response: { d: false }
*/

class WSClient {
  private readonly gateway: string

  private readonly token: string

  private readonly packer: Packer

  private readonly options: GatewayConnectionOptions

  private ws?: WebSocket

  private sessionID?: string

  private lastSequenceNumber?: number

  private heartbeatTimer?: NodeJS.Timeout

  private heartbeatTimeout?: NodeJS.Timeout

  private receivedHeartbeatAck?: boolean

  private _ready = false

  public get ready(): boolean {
    return this._ready && this.ws?.readyState === WebSocket.OPEN
  }

  /// Should connection be resumed after connecting?
  shouldResume = false

  public onMessage?: (message: GatewayMessage) => void

  public onChangedReadyState?: (ready: boolean) => void

  public onError?: (error: Error) => void

  public onConnectionClosed?: (code: number, reason?: string) => void

  constructor(gateway: string, token: string, packer: Packer, options: GatewayConnectionOptions) {
    this.gateway = gateway
    this.token = token
    this.packer = packer
    this.options = options
  }

  public connect = () => {
    if (this.ready || (this.ws?.readyState === WebSocket.CONNECTING) || this.ws?.readyState === WebSocket.OPEN) {
      texts.log(LOG_PREFIX, `Attempted to connect, but is already ready/connecting, ready: ${this.ready}, state: ${this.ws?.readyState}`)
      return
    }

    const urlParts = {
      v: this.options.version.toString(),
      encoding: this.options.encoding.toString(),
      // compress: this.options.compress?.toString() ?? ''
    }
    const urlParams = new URLSearchParams(urlParts)
    const gatewayURL = `${this.gateway}?${urlParams.toString()}`
    texts.log(LOG_PREFIX, 'Opening WebSocket, URL:', gatewayURL)
    this.ws = new WebSocket(gatewayURL)
    this.setupHandlers()
  }

  public disconnect = (code: number = GatewayCloseCode.MANUAL_DISCONNECT) => {
    texts.log(LOG_PREFIX, `Disconnect called with code ${code}`)
    clearInterval(this.heartbeatTimer!)
    clearTimeout(this.heartbeatTimeout!)
    this.ws?.close(code)
  }

  public send = async (message: GatewayMessage) => {
    if (DEBUG) texts.log('<', message)

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
    this.ws.on('error', WSClient.wsError)
    this.ws.on('unexpected-response', WSClient.wsUnexpectedResponse)
  }

  private wsOpen = () => {
    texts.log(LOG_PREFIX, 'WebSocket open!')
    this._ready = true
  }

  private wsClose = (code: number, reason: string) => {
    texts.log(LOG_PREFIX, 'WebSocket closed, code:', code)
    this._ready = false
    clearInterval(this.heartbeatTimer!)

    if (code === GatewayCloseCode.RECONNECT_REQUESTED) {
      this.shouldResume = true
      this.disconnect(GatewayCloseCode.RECONNECT_REQUESTED)
      this.connect()
      return
    }

    this.onConnectionClosed?.(code, reason)
  }

  private wsMessage = (data: WebSocket.Data) => {
    try {
      const unpacked = this.packer.unpack(data) as GatewayMessage
      if (!unpacked) throw WSError.errorUnpacking
      this.handleMessage(unpacked)
    } catch (e) {
      texts.error(LOG_PREFIX, 'Error unpacking', e, data)
      this.onError?.(e as Error)
    }
  }

  private handleMessage = (message: GatewayMessage) => {
    if (DEBUG) texts.log('>', message)

    if (message.s) {
      const expectedSequenceNumber = (this.lastSequenceNumber ?? 0) + 1
      if (message.s !== expectedSequenceNumber) texts.error(LOG_PREFIX, `Sequence # mismatch! Expected: ${expectedSequenceNumber}, got: ${message.s}.`)

      this.lastSequenceNumber = message.s
    }

    switch (message.op) {
      case OPCode.DISPATCH:
        this.handleDispatch(message)
        break
      case OPCode.HEARTBEAT:
        this.sendHeartbeat()
        break
      case OPCode.RECONNECT:
      case OPCode.INVALID_SESSION:
        texts.log(LOG_PREFIX, `OP: ${message.op}, reconnecting...`)
        this._ready = false
        this.shouldResume = false
        this.disconnect(GatewayCloseCode.MANUAL_DISCONNECT)
        this.connect()
        break
      case OPCode.HELLO:
        this.setupHeartbeat(message.d.heartbeat_interval)
        this.sendIdentifyOrResume()
        this.shouldResume = false
        break
      case OPCode.HEARTBEAT_ACK: {
        if (DEBUG) texts.log(LOG_PREFIX, 'Got HEARTBEAT_ACK!')
        this.receivedHeartbeatAck = true
        break
      }

      // * Send-only
      case OPCode.IDENTIFY:
      case OPCode.PRESENCE_UPDATE:
      case OPCode.VOICE_STATE_UPDATE:
      case OPCode.RESUME:
      case OPCode.REQUEST_GUILD_MEMBERS: {
        // Shouldn't ever happen
        texts.log(LOG_PREFIX, `Received send-only OPCode (${message.op})!`, message)
        break
      }

      // * Default

      default: {
        texts.log(LOG_PREFIX, `Unhandled OPCode (${message.op})!`, message)
        break
      }
    }

    this.onMessage?.(message)
  }

  private setupHeartbeat = (interval: number) => {
    if (DEBUG) texts.log(LOG_PREFIX, `Setting heartbeat interval to ${interval}`)

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
    // TODO: Resuming returns `d: false`
    this.shouldResume = false

    if (DEBUG) texts.log(LOG_PREFIX, this.shouldResume ? 'Resuming...' : 'Sending identify...')

    let payload: GatewayMessage
    if (this.shouldResume) {
      payload = {
        op: OPCode.RESUME,
        d: {
          token: this.token,
          session_id: this.sessionID,
          seq: this.lastSequenceNumber,
        },
      }
    } else {
      payload = {
        op: OPCode.IDENTIFY,
        d: {
          token: this.token,
          capabilities: 509, // sniffed
          properties: SUPER_PROPERTIES,
          presence: {
            status: DiscordPresenceStatus.ONLINE,
            since: 0,
            activities: [],
            afk: false,
          },
          compress: false,
          client_state: {
            guild_hashes: {},
            highest_last_message_id: '0',
            read_state_version: 0,
            user_guild_settings_version: -1,
            user_settings_version: -1,
          },
        },
      }
    }

    this.send(payload)
  }

  private sendHeartbeat = () => {
    if (DEBUG) texts.log(LOG_PREFIX, 'Sending heartbeat...')

    if (!this.receivedHeartbeatAck) {
      // TODO: Check this - connection zombified, https://discord.com/developers/docs/topics/gateway#heartbeating
      texts.log(LOG_PREFIX, 'Connection zombified')
      this.shouldResume = true
      this.disconnect(GatewayCloseCode.RECONNECT_REQUESTED)
      this.connect()
      return
    }

    const payload: GatewayMessage = {
      op: OPCode.HEARTBEAT,
      d: this.lastSequenceNumber,
    }
    this.send(payload)
    this.receivedHeartbeatAck = false
  }

  private handleDispatch = (message: GatewayMessage) => {
    switch (message.t) {
      case GatewayMessageType.READY: {
        if (DEBUG) texts.log(LOG_PREFIX, 'Got dispatch <READY>!')
        this.sessionID = message.d?.session_id
        break
      }
      case GatewayMessageType.SESSIONS_REPLACE: {
        const session = message.d?.at(0)
        if (session.session_id) this.sessionID = session.session_id
        break
      }

      case GatewayMessageType.RESUMED: {
        const presencePayload = {
          op: OPCode.PRESENCE_UPDATE,
          d: {
            status: DiscordPresenceStatus.ONLINE,
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

  private static wsError = (err: Error) => {
    if (DEBUG) texts.log(LOG_PREFIX, `WebSocket error: ${err}`)
  }

  private static wsUnexpectedResponse = (request: ClientRequest, response: IncomingMessage) => {
    if (DEBUG) texts.log(LOG_PREFIX, 'WebSocket unexpected response!', request, response)
  }
}

export default WSClient
