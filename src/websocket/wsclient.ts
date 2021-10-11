import os from 'os'
import WebSocket, { MessageEvent } from 'ws'
import { texts } from '@textshq/platform-sdk'
import { DiscordPresenceStatus, OPCode, GatewayMessageType, GatewayCloseCode } from './constants'
import type { GatewayMessage } from './types'
import type { Packer } from '../packers'
import { sleep, SUPER_PROPERTIES } from '../util'
import { ENABLE_GUILDS, ACT_AS_USER, RESTART_ON_FAIL } from '../preferences'

export default class WSClient {
  private ws?: WebSocket

  private sessionID?: number | undefined

  private lastSequenceNumber?: number | undefined

  private resumeConnectionOnConnect = false

  private heartbeatInterval?: NodeJS.Timeout

  private failedRetries = 0

  private constants = {
    capabilities: 125, // sniffed
    intents: ENABLE_GUILDS ? 32515 : 28672, // https://discord.com/developers/docs/topics/gateway#gateway-intents
  }

  ready = false

  onMessage?: (opcode: OPCode, message: any, type?: GatewayMessageType) => void

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
    texts.log('[discord ws] Opening gateway connection. Try: ', this.failedRetries)

    // this.disconnect()

    await sleep(Math.min(this.failedRetries, 10) * 1000)

    this.ws = new WebSocket(this.gateway)
    this.setupHandlers()
  }

  disconnect = () => {
    clearInterval(this.heartbeatInterval)

    this.lastSequenceNumber = null
    this.ws?.close()
    this.ws = null
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

      this.failedRetries = 0
    })

    this.ws?.on('close', async (code, reason) => {
      this.ready = false
      this.onChangedReadyState?.(false)

      if (RESTART_ON_FAIL && code !== GatewayCloseCode.UNKNOWN_ERROR) {
        switch (code) {
          case GatewayCloseCode.AUTHENTICATION_FAILED:
            break

          case GatewayCloseCode.DISCONNECTED:
            this.disconnect()
            this.failedRetries += 1
            await this.connect()
            break

          case undefined:
            this.resumeConnectionOnConnect = true
            break
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
      case OPCode.INVALID_SESSION:
        texts.error('[discord ws] invalid session')
        this.disconnect()
        this.connect()
        break
      default:
        break
    }

    this.onMessage?.(message.op, message.d, message.t)
  }

  private send = async (payload: GatewayMessage) => {
    while (this.ws.readyState === this.ws.CONNECTING) await sleep(25)
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
        properties: SUPER_PROPERTIES,
        presence: {
          status: DiscordPresenceStatus.ONLINE,
          since: 0,
          activities: [],
          afk: false,
        },
        compress: this.packer.encoding === 'etf',
      },
    }

    if (ACT_AS_USER) {
      payload.d.capabilities = this.constants.capabilities
      payload.d.client_state = {
        guild_hashes: {},
        highest_last_message_id: '0',
        read_state_version: 0,
        user_guild_settings_version: -1,
      }
    } else {
      payload.d.intents = this.constants.intents
    }

    this.send(payload)
  }
}
