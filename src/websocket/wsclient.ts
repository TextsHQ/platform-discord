import WebSocket, { MessageEvent } from 'ws'
import { texts } from '@textshq/platform-sdk'
import { DiscordPresenceStatus, OPCode, GatewayMessageType, GatewayCloseCode } from './constants'
import type { GatewayMessage } from './types'
import type { Packer } from '../packers'
import { sleep, SUPER_PROPERTIES } from '../util'

export default class WSClient {
  private ws?: WebSocket

  private sessionID?: number | undefined

  private lastSequenceNumber?: number | undefined

  private resumeConnectionOnConnect = false

  private heartbeatInterval?: NodeJS.Timeout

  private constants = {
    capabilities: 125, // sniffed
  }

  ready: boolean = false

  onMessage?: (opcode: OPCode, data: any, type?: GatewayMessageType) => void

  onChangedReadyState?: (ready: boolean) => void

  onError?: (error: Error) => void

  onConnectionClosed?: (code: number, reason: string) => void

  constructor(
    public gateway: string,
    private token: string,
    private packer: Packer,
  ) {
    // this.connect()
  }

  connect = async () => {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return

    texts.log('[discord ws] Opening gateway connection...')

    this.ws = new WebSocket(this.gateway)
    this.setupHandlers()
  }

  disconnect = () => {
    if (!this.ws) return
    texts.log('[discord ws] Disconnecting')
    clearInterval(this.heartbeatInterval)
    this.lastSequenceNumber = null
    this.ws?.close(GatewayCloseCode.MANUAL_DISCONNECT)
    this.ws = null
    this.setReadyState(false)
  }

  private setupHandlers = () => {
    this.ws.on('open', async () => {
      texts.log('[discord ws] Connection open')
      if (!this.ready) await this.login()
    })

    this.ws.on('close', async (code, reason) => {
      texts.log(`[discord ws] Connection closed. Code: ${code}, reason: ${reason}`)
      this.setReadyState(false)

      switch (code) {
        case GatewayCloseCode.DISCONNECTED:
        case GatewayCloseCode.ADDRESS_NOT_FOUND:
          this.disconnect()
          break

        case GatewayCloseCode.RECONNECT_REQUESTED:
          texts.log('[discord ws] Gateway requested client reconnect.')
          this.disconnect()
          this.connect()
          break

        // case undefined:
        default:
          // this.resumeConnectionOnConnect = true
          break
      }

      this.onConnectionClosed?.(code, reason)
    })

    this.ws.on('error', error => this.onError?.(error))

    this.ws.on('unexpected-response', (request, response) => {
      texts.log('[discord ws] Unexpected response: ' + request, response)
    })

    this.ws.onmessage = this.wsOnMessage
  }

  private setReadyState = (ready: boolean) => {
    if (ready === this.ready) return
    this.ready = ready
    this.onChangedReadyState?.(ready)
  }

  private processMessage = async (message: GatewayMessage) => {
    this.lastSequenceNumber = message.s
    // console.log('>', message.op, message.t)

    switch (message.op) {
      case OPCode.DISPATCH:
        if (message.t === GatewayMessageType.READY) {
          this.sessionID = message.d.session_id
        }

        this.setReadyState(true)
        this.onMessage?.(message.op, message.d, message.t)
        break
      case OPCode.HEARTBEAT:
        this.sendHeartbeat()
        break
      case OPCode.HELLO:
        texts.log(`[discord ws] Heartbeat interval: ${message.d.heartbeat_interval}`)
        this.heartbeatInterval = setInterval(this.sendHeartbeat, message.d.heartbeat_interval)
        this.setReadyState(true)
        break
      case OPCode.INVALID_SESSION:
        texts.error('[discord ws] Invalid session')
        this.disconnect()
        await this.connect()
        break
      default:
        break
    }
  }

  private wsOnMessage = (event: MessageEvent) => {
    try {
      const unpacked = this.packer.unpack(event.data)
      if (unpacked) this.processMessage(unpacked as GatewayMessage)
    } catch (e) {
      texts.error('[discord ws] Error unpacking:', e, event)
      this.onError?.(e)
    }
  }

  private sendHeartbeat = async () => {
    // texts.log('[discord ws] Sending heartbeat')
    if (this.ws.readyState === this.ws.CONNECTING) return
    const payload: GatewayMessage = { op: OPCode.HEARTBEAT, d: this.lastSequenceNumber }
    await this.send(payload)
  }

  private login = async () => {
    if (this.ready) return

    if (this.resumeConnectionOnConnect) {
      const payload: GatewayMessage = {
        op: OPCode.RESUME,
        d: {
          token: this.token,
          session_id: this.sessionID,
          seq: this.lastSequenceNumber,
        },
      }
      await this.send(payload)
      this.resumeConnectionOnConnect = false
    } else {
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
          compress: this.packer.encoding === 'etf',
          capabilities: this.constants.capabilities,
          client_state: {
            guild_hashes: {},
            highest_last_message_id: '0',
            read_state_version: 0,
            user_guild_settings_version: -1,
          },
        },
      }

      await this.send(payload)
    }
  }

  private send = async (payload: GatewayMessage) => {
    // console.log('<', payload)

    if (!this.ws) return
    while (this.ws.readyState === WebSocket.CONNECTING) await sleep(25)
    const packed = this.packer.pack(payload)
    this.ws.send(packed)
  }
}
