import { texts } from '@textshq/platform-sdk'
import type { ClientRequest, IncomingMessage } from 'http'
import WebSocket from 'ws'
import { SUPER_PROPERTIES } from '../discord-constants'
import type { Packer } from '../packers'
import { DEBUG } from '../preferences'
import { DiscordPresenceStatus, GatewayMessageType, OPCode } from './constants'
import { WSError } from './errors'
import type { GatewayConnectionOptions, GatewayMessage } from './types'

const LOG_PREFIX = '[discord ws]'

class WSClient {
  private readonly gateway: string

  private readonly token: string

  private readonly packer: Packer

  private readonly options: GatewayConnectionOptions

  private ws?: WebSocket

  private sessionID?: number

  private lastSequenceNumber?: number

  private heartbeatTimer?: NodeJS.Timer

  private receivedHeartbeatAck: boolean = false

  private _ready: boolean = false

  public get ready(): boolean {
    return this._ready
  }

  public onMessage?: (message: GatewayMessage) => void

  public onChangedReadyState?: (ready: boolean) => void

  public onError?: (error: Error) => void

  public onConnectionClosed?: (code: number, reason: string) => void

  constructor(gateway: string, token: string, packer: Packer, options: GatewayConnectionOptions) {
    this.gateway = gateway
    this.token = token
    this.packer = packer
    this.options = options
  }

  public connect = async () => {
    if (this.ready || (this.ws?.readyState == WebSocket.CONNECTING) || this.ws?.readyState == WebSocket.OPEN) {
      texts.log(LOG_PREFIX, `Attempted to connect, but is already ready/connecting, ready: ${this.ready}, state: ${this.ws?.readyState}`)
      return
    }

    const gatewayURL = `${this.gateway}?v=${encodeURIComponent(this.options.version)}&encoding=${encodeURIComponent(this.options.encoding)}&compress=${encodeURIComponent(this.options.compress ?? '')}`
    console.log(gatewayURL)
    this.ws = new WebSocket(gatewayURL)
    this.setupHandlers()
  }

  public disconnect = () => {
    // TODO: disconnect
  }

  public send = async (message: GatewayMessage) => {
    if (DEBUG) texts.log('>', message)

    if (!this.ws) {
      texts.error(LOG_PREFIX, 'Attempted to send, but there\'s no ws!')
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

    this.ws.on('open', this.onWSOpen)
    this.ws.on('close', this.onWSClose)
    this.ws.on('message', this.onWSMessage)
    this.ws.on('error', this.onWSError)
    this.ws.on('unexpected-response', this.onWSUnexpectedResponse)
  }

  private onWSOpen = () => {
    texts.log(LOG_PREFIX, 'WebSocket open!')

  }

  private onWSClose = (code: number, reason: string) => {
    texts.log(LOG_PREFIX, `WebSocket closed! Code: ${code}, reason: '${reason}'`)
  }

  private onWSMessage = (data: WebSocket.Data) => {
    try {
      const unpacked = this.packer.unpack(data) as GatewayMessage
      if (!unpacked) throw WSError.errorUnpacking
      if (DEBUG) texts.log('<', unpacked)
      this.handleMessage(unpacked)
    } catch (e) {
      texts.error('[discord ws] Error unpacking', e, data)
      this.onError?.(e as Error)
    }
  }

  private onWSError = (err: Error) => {
    texts.log(LOG_PREFIX, `WebSocket error: ${err}`)
  }

  private onWSUnexpectedResponse = (request: ClientRequest, response: IncomingMessage) => {
    texts.log(LOG_PREFIX, 'WebSocket unexpected response!', request, response)
  }

  private handleMessage = ({ op, d, s, t }: GatewayMessage) => {
    if (s) this.lastSequenceNumber = s

    switch (op) {
      case OPCode.DISPATCH: {
        break
      }
      case OPCode.HEARTBEAT: {
        this.sendHeartbeat()
        break
      }
      case OPCode.RECONNECT: {
        break
      }
      case OPCode.INVALID_SESSION: {
        break
      }
      case OPCode.HELLO: {
        this.setupHeartbeat(d.heartbeat_interval)
        this.sendIdentify()
        break
      }
      case OPCode.HEARTBEAT_ACK: {
        this.receivedHeartbeatAck = true
        break
      }

      // * Send-only

      case OPCode.IDENTIFY:
      case OPCode.PRESENCE_UPDATE:
      case OPCode.VOICE_STATE_UPDATE:
      case OPCode.RESUME:
      case OPCode.REQUEST_GUILD_MEMBERS: {
        // Shouldn't ever happend
        texts.log(LOG_PREFIX, `Received send-only OPCode (${op})!`, d, s, t)
        break
      }

      // * Default

      default: {
        texts.log(LOG_PREFIX, `Unhandled OPCode (${op})!`, d, s, t)
        break
      }
    }
  }

  private setupHeartbeat = (interval: number) => {
    texts.log(LOG_PREFIX, `Setting interval to ${interval}`)

    const jitter = Math.random()
    setTimeout(() => {
      this.sendHeartbeat()
      this.heartbeatTimer = setInterval(this.sendHeartbeat, interval)
    }, interval + jitter)
  }

  private sendIdentify = () => {
    const payload: GatewayMessage = {
      op: OPCode.IDENTIFY,
      d: {
        token: this.token,
        properties: SUPER_PROPERTIES,
        presence: {
          status: DiscordPresenceStatus.ONLINE,
          since: 0,
          activities: [],
          afk: false,
        },
        compress: !!this.options.compress && this.packer.compress,
        capabilities: 125, // sniffed
        client_state: {
          guild_hashes: {},
          highest_last_message_id: '0',
          read_state_version: 0,
          user_guild_settings_version: -1,
        },
      },
    }
    this.send(payload)
  }

  private sendHeartbeat = () => {
    if (!this.receivedHeartbeatAck) {
      // TODO: connection zombified, https://discord.com/developers/docs/topics/gateway#heartbeating
    }

    this.receivedHeartbeatAck = false

    const payload: GatewayMessage = {
      op: OPCode.HEARTBEAT,
      d: this.lastSequenceNumber
    }
    this.send(payload)
  }
}

export default WSClient
