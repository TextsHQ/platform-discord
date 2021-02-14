import os from 'os'
import WebSocket, { MessageEvent } from 'ws'
import erlpack from 'erlpack'
import { DiscordPresenceStatus, OPCode, GatewayMessageType } from './constants'
import { GatewayMessage } from './types'

const REQUESTS_PER_MINUTE_LIMIT = 120

export default class WSClient {
  private readonly ws: WebSocket

  private token: string

  private sessionID?: number | undefined

  private lastSequenceNumber?: number | undefined

  private requestsPerMinuteLeft: number = REQUESTS_PER_MINUTE_LIMIT

  private resumeConnectionOnConnect: boolean = false

  private heartbeatInterval?

  public ready: boolean = false

  public restartOnFail: boolean = true

  public onMessage?: (opcode: OPCode, message: any, type?: GatewayMessageType) => void

  public onChangedReadyState?: (ready: boolean) => void

  public onError?: (error: Error) => void

  public onConnectionClosed?: (code: number, reason: string) => void

  constructor(gateway: string, token: string) {
    this.token = token
    this.ws = new WebSocket(gateway)

    this.setupHandlers()

    /*
      Discord will disconnect us from gateway if we issue to many requests per minute.
      This is optional, but it's better than having to reconnect.
     */
    setInterval(() => {
      this.requestsPerMinuteLeft = REQUESTS_PER_MINUTE_LIMIT
    }, 60000)
  }

  public disconnect = () => {
    clearInterval(this.heartbeatInterval)
    this.lastSequenceNumber = null
    this.ws.close()
  }

  private setupHandlers = () => {
    this.ws.on('open', () => {
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
          this.send(payload, true)
        } else {
          this.login()
        }
      }
    })

    this.ws.on('close', (code, reason) => {
      this.ready = false
      this.onChangedReadyState?.(false)
      if (code === undefined && this.restartOnFail) this.resumeConnectionOnConnect = true
      this.onConnectionClosed?.(code, reason)
    })

    this.ws.on('error', error => this.onError?.(error) )

    this.ws.on('unexpected-response', (request, response) => {
      console.log('Unexpected response: ' + request, response)
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
      console.error('Error unpacking: ' + e)
      console.error(event)
      this.onError?.(e)
    }
  }

  private sendHeartbeat = () => {
    // console.log('[!] Sending heartbeat')
    const payload: GatewayMessage = { op: OPCode.HEARTBEAT, d: this.lastSequenceNumber }
    this.send(payload)
  }

  private setHeartbeatInterval = (interval: number) => {
    console.log('Heartbeat interval set to ' + interval)
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
    this.send(payload)
  }

  private send = (payload: GatewayMessage, force: boolean = false): boolean => {
    if (this.requestsPerMinuteLeft === 0 && !force) return false
    const packed = erlpack.pack(payload)
    this.ws.send(packed)
    return true
  }
}
