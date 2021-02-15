import os from 'os'
import WebSocket, { MessageEvent } from 'ws'
import erlpack from 'erlpack'
import { DiscordPresenceStatus, OPCode, GatewayMessageType, GatewayCloseCode } from './constants'
import { GatewayMessage } from './types'
import { texts } from '@textshq/platform-sdk'

export default class WSClient {
  private ws?: WebSocket

  private token: string

  private sessionID?: number | undefined

  private lastSequenceNumber?: number | undefined

  private resumeConnectionOnConnect = false

  private heartbeatInterval?: NodeJS.Timeout

  public ready = false

  public restartOnFail = true

  public gateway: string

  public onMessage?: (opcode: OPCode, message: any, type?: GatewayMessageType) => void

  public onChangedReadyState?: (ready: boolean) => void

  public onError?: (error: Error) => void

  public onConnectionClosed?: (code: number, reason: string) => void

  constructor(gateway: string, token: string) {
    this.token = token
    this.gateway = gateway
    this.connect()
  }

  public connect = () => {
    texts.log('Opening gateway connection...')
    this.ws = new WebSocket(this.gateway)
    this.setupHandlers()
  }

  public disconnect = () => {
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
            op: 6,
            d: {
              token: this.token,
              session_id: this.sessionID,
              seq: this.lastSequenceNumber,
            },
          }
          const packed = erlpack.pack(payload)
          this.ws.send(packed)
        } else {
          this.login()
        }
      }
    })

    this.ws?.on('close', (code, reason) => {
      this.ready = false
      this.onChangedReadyState?.(false)
      if (this.restartOnFail) {
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

    this.ws?.on('error', error => this.onError?.(error) )

    this.ws?.on('unexpected-response', (request, response) => {
      texts.log('Unexpected response: ' + request, response)
    })

    this.ws.onmessage = this.messageHandler
  }

  private messageHandler = (event: MessageEvent) => {
    let unpacked: GatewayMessage | undefined
    try {
      unpacked = erlpack.unpack(event.data as Buffer)
      this.lastSequenceNumber = unpacked.s
      this.onMessage?.(unpacked.op, unpacked.d, unpacked.t)

      switch (unpacked.op) {
        case OPCode.DISPATCH:
          if (!this.ready && unpacked.t === GatewayMessageType.READY) {
            this.sessionID = unpacked.d.session_id
            this.ready = true
            this.onChangedReadyState?.(true)
          }

          break
        case OPCode.HEARTBEAT:
          this.sendHeartbeat()
          break
        case OPCode.HELLO:
          this.setHeartbeatInterval(unpacked.d.heartbeat_interval)
          break
        case OPCode.HEARTBEAT_ACK:
          break
        default:
          break
      }
    } catch (e) {
      texts.error('Error unpacking: ' + e)
      texts.error(event)
      this.onError?.(e)
    }
  }

  private sendHeartbeat = () => {
    // texts.log('[!] Sending heartbeat')
    const payload: GatewayMessage = { op: OPCode.HEARTBEAT, d: this.lastSequenceNumber }
    const packed = erlpack.pack(payload)
    this.ws.send(packed)
  }

  private setHeartbeatInterval = (interval: number) => {
    texts.log('Heartbeat interval set to ' + interval)
    this.heartbeatInterval = setInterval(this.sendHeartbeat, interval)
  }

  private login = () => {
    // TODO: Check intents in Discord client
    const payload: GatewayMessage = {
      op: OPCode.IDENTIFY,
      d: {
        token: this.token,
        intents: 28672, // DIRECT_MESSAGES, DIRECT_MESSAGE_REACTIONS, DIRECT_MESSAGE_TYPING
        compress: true,
        presence: {
          status: DiscordPresenceStatus.ONLINE,
          afk: false,
        },
        properties: {
          $os: os.platform(),
          $browser: 'Texts',
          $device: os.hostname(),
        },
      },
    }
    const packed = erlpack.pack(payload)
    this.ws.send(packed)
  }
}
