import os from 'os'
import WebSocket, { MessageEvent } from 'ws'
import { texts } from '@textshq/platform-sdk'
import { DiscordPresenceStatus, OPCode, GatewayMessageType, GatewayCloseCode } from './constants'
import type { GatewayMessage } from './types'
import type { Packer } from '../packers'
import { sleep } from '../util'

export default class WSClient {
  private ws?: WebSocket

  private sessionID?: number | undefined

  private lastSequenceNumber?: number | undefined

  private resumeConnectionOnConnect = false

  private heartbeatInterval?: NodeJS.Timeout

  private constants = {
    browser: 'Chrome',
    releaseChannel: 'stable',
    buildNumber: 92358,
    capabilities: 125, // sniffed
    intents: this.enableGuilds ? 32515 : 28672, // https://discord.com/developers/docs/topics/gateway#gateway-intents
  }

  ready = false

  restartOnFail = true

  onMessage?: (opcode: OPCode, message: any, type?: GatewayMessageType) => void

  onChangedReadyState?: (ready: boolean) => void

  onError?: (error: Error) => void

  onConnectionClosed?: (code: number, reason: string) => void

  constructor(
    public gateway: string,
    private token: string,
    private enableGuilds = false,
    private actAsUser = false,
    private packer: Packer,
  ) {
    this.connect()
  }

  connect = () => {
    // texts.log('[discord ws] Opening gateway connection...')
    this.ws = new WebSocket(this.gateway)
    this.setupHandlers()
  }

  disconnect = () => {
    clearInterval(this.heartbeatInterval)
    this.lastSequenceNumber = null
    this.ws?.close()
  }

  private setupHandlers = () => {
    this.ws?.on('open', () => {
      if (!this.ready) {
        if (this.resumeConnectionOnConnect) {
          this.resumeConnectionOnConnect = false
          const payload: GatewayMessage = {
            op: OPCode.RESUME,
            d: {
              token: this.token,
              session_id: this.sessionID,
              seq: this.lastSequenceNumber,
            },
          }
          this.send(payload)
        } else {
          this.login()
        }
      }
    })

    this.ws?.on('close', (code, reason) => {
      this.ready = false
      this.onChangedReadyState?.(false)
      if (this.restartOnFail && code !== GatewayCloseCode.UNKNOWN_ERROR) {
        if (code === undefined) {
          this.resumeConnectionOnConnect = true
        }

        if (code !== GatewayCloseCode.DISCONNECTED) {
          this.ws = null
          this.ws = new WebSocket(this.gateway)
          this.setupHandlers()
        }
      }
      this.onConnectionClosed?.(code, reason)
    })

    this.ws?.on('error', error => this.onError?.(error))

    this.ws?.on('unexpected-response', (request, response) => {
      texts.log('[discord ws] Unexpected response: ' + request, response)
    })

    this.ws.onmessage = this.wsOnMessage
  }

  private processMessage = (message: GatewayMessage) => {
    this.lastSequenceNumber = message.s
    this.onMessage?.(message.op, message.d, message.t)

    switch (message.op) {
      case OPCode.DISPATCH:
        if (!this.ready && message.t === GatewayMessageType.READY) {
          this.sessionID = message.d.session_id
          this.ready = true
          this.onChangedReadyState?.(true)
        }

        break
      case OPCode.HEARTBEAT:
        this.sendHeartbeat()
        break
      case OPCode.HELLO:
        this.setHeartbeatInterval(message.d.heartbeat_interval)
        break
      case OPCode.HEARTBEAT_ACK:
        break
      default:
        break
    }
  }

  private waitAndSend = async (payload: GatewayMessage) => {
    while (this.ws.readyState === this.ws.CONNECTING) {
      await sleep(25)
    }
    this.send(payload)
  }

  private send = (payload: GatewayMessage) => {
    if (this.ws.readyState === this.ws.CONNECTING) {
      return this.waitAndSend(payload)
    }
    const packed = this.packer.pack(payload)
    this.ws.send(packed)
  }

  private wsOnMessage = (event: MessageEvent) => {
    try {
      const unpacked = this.packer.unpack(event.data)
      if (unpacked) this.processMessage(unpacked as GatewayMessage)
    } catch (e) {
      texts.error('[discord ws] error unpacking:', e, event)
      this.onError?.(e)
    }
  }

  private sendHeartbeat = () => {
    // texts.log('[discord ws] Sending heartbeat')
    if (this.ws.readyState === this.ws.CONNECTING) return
    const payload: GatewayMessage = { op: OPCode.HEARTBEAT, d: this.lastSequenceNumber }
    this.send(payload)
  }

  private setHeartbeatInterval = (interval: number) => {
    texts.log('[discord ws] Heartbeat interval set to', interval)
    this.heartbeatInterval = setInterval(this.sendHeartbeat, interval)
  }

  private login = () => {
    const payload: GatewayMessage = {
      op: OPCode.IDENTIFY,
      d: {
        token: this.token,
        properties: {
          browser_user_agent: texts.constants.USER_AGENT,
          browser_version: os.version(),
          client_build_number: this.constants.buildNumber,
          client_event_source: null,
          device: '',
          os: os.platform(),
          os_version: os.version(),
          referrer: '',
          referrer_current: '',
          referring_domain: '',
          referring_domain_current: '',
          release_channel: this.constants.releaseChannel,
          system_locale: 'en-US',
        },
        presence: {
          status: DiscordPresenceStatus.ONLINE,
          since: Date.now(),
          activites: [],
          afk: false,
        },
        compress: this.packer.encoding === 'etf',
        capabilities: this.actAsUser ? this.constants.capabilities : undefined,
        intents: this.actAsUser ? undefined : this.constants.intents,
        client_state: this.actAsUser ? {
          guild_hashes: {},
          highest_last_message_id: '0',
          read_state_version: 0,
          user_guild_settings_version: -1,
        } : undefined,
      },
    }
    this.send(payload)
  }
}
