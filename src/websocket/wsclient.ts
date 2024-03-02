import { texts } from '@textshq/platform-sdk'
import PersistentWS from '@textshq/platform-sdk/dist/PersistentWS'
import type { Data as WSData } from 'ws'

import { SUPER_PROPERTIES } from '../discord-constants'
import type { Packer } from '../packers'
import { DEBUG } from '../preferences'
import { DiscordPresenceStatus, GatewayCloseCode, GatewayMessageType, OPCode, RECONNECT_AND_RESUME_CLOSE_CODES, RECONNECT_DONT_RESUME_CLOSE_CODES } from './constants'
import { WSError } from './errors'
import type { GatewayConnectionOptions, GatewayMessage } from './types'

const LOG_PREFIX = '[discord ws]'

// TODO: Although inconsistent, this function is really useful for debugging
// complicated network flows. In the future, make logging better in PAS/desktop
// and remove this.
function log(...args: any[]) {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, -1)
  texts.log(`[${timestamp}] [discord/WSClient]`, ...args)
}

// TODO: Might want to expose this on the platform-sdk side.
type PersistentWSConnectionInfo = ReturnType<ConstructorParameters<typeof PersistentWS>[0]>

/*
    * Reconnecting with IDENTIFY
    + Works
    - We don't know about skipped events

    * Reconnecting with RESUME
    ? how
    ? response: { d: false }
*/

class WSClient {
  private ws?: PersistentWS

  private sessionID?: string

  /**
    * The gateway URL to connect to when we're reconnecting and wish to RESUME.
    */
  private resumeGatewayURL: string | null = null

  private lastSequenceNumber?: number

  private heartbeatTimer?: NodeJS.Timeout

  private heartbeatTimeout?: NodeJS.Timeout

  private receivedHeartbeatAck?: boolean

  /**
    * Indicates whether the WebSocket connection is _open_ and we _believe_
    * that we're connected to the Gateway. This does NOT reflect whether we
    * have a valid session with Discord or not, and the connection could also
    * be dead at this point (pending timeout).
    */
  public get connected(): boolean {
    return this.ws?.connected
  }

  /**
    * Indicates whether we are resuming soon.
    *
    * This will signal the designated gateway URL for resumption (that was
    * received in a previous `READY`) to be used. `RESUME` will be sent instead
    * of `IDENTIFY` upon receiving `HELLO`.
    */
  shouldResume = false

  /**
    * Whether we should tell {@linkcode PersistentWS} to _always_ reconnect
    * when the WebSocket closes. Normally, reconnections only occur for certain
    * close codes.
    */
  performingManualReconnect = false

  /// A callback to expose incoming gateway messages downstream.
  public gatewayMessageHandler?: (message: GatewayMessage) => void

  /**
    * Called with `true` when the gateway sends `READY` (or `RESUMED`, in the
    * case of resumption). Called with `false` when the WebSocket connection
    * is closed for any reason.
    */
  public onChangedReadyState?: (ready: boolean) => void

  public onError?: (error: Error) => void

  public onConnectionClosed?: (code: number) => void

  constructor(
    private readonly initialGatewayURL: string,
    private readonly token: string,
    private readonly packer: Packer,
    private readonly options: GatewayConnectionOptions,
  ) {
    log(`creating new PersistentWS (eventually connecting to: ${initialGatewayURL})`)
    this.ws = new PersistentWS(
      this.getConnectionInfo,
      this.persistentWSMessage,
      () => { log('websocket has opened!') },
      this.persistentWSClose,
    )
  }

  private getConnectionInfo = (): PersistentWSConnectionInfo => {
    const urlParams = new URLSearchParams({
      v: this.options.version.toString(),
      encoding: this.options.encoding.toString(),
      // compress: this.options.compress?.toString() ?? ''
    })

    let baseGatewayURL = this.initialGatewayURL
    if (this.shouldResume) {
      if (this.resumeGatewayURL) {
        if (DEBUG) log(`getConnectionInfo: using resume gateway URL ${this.resumeGatewayURL}`)
        baseGatewayURL = this.resumeGatewayURL
      } else {
        const msg = '[discord/WSClient] ERROR: we need to resume, but we don\'t have a resume gateway URL - using base gateway URL'
        texts.error(msg)
        texts.Sentry.captureMessage(msg)
      }
    }

    const endpoint = `${baseGatewayURL}?${urlParams.toString()}`
    return { endpoint }
  }

  public connect = () => {
    if (this.ws?.connected) {
      const msg = '[discord/WSClient] ERROR: attempted to connect, but we\'re already connected'
      texts.error(msg)
      texts.Sentry.captureMessage(msg)
      return
    }

    log('telling PersistentWS to connect now')
    this.ws.connect()
  }

  public disconnect = (code: number = GatewayCloseCode.CLOSE_NORMAL) => {
    log(`disconnecting with code ${code}`)
    clearInterval(this.heartbeatTimer!)
    clearTimeout(this.heartbeatTimeout!)
    this.ws.disconnect(code)
  }

  public reconnect = (options: { wantsResume: boolean }) => {
    this.performingManualReconnect = true
    this.updateResumptionState(options.wantsResume)
    this.ws?.forceDisconnect()
  }

  public send = async (message: GatewayMessage) => {
    if (DEBUG) texts.log('<', message)
    const packed = this.packer.pack(message)
    this.ws.send(packed)
  }

  /**
    * Called when the persistent WebSocket closes for whatever reason.
    *
    * Here, we decide whether to `RESUME` the next time we connect (depending
    * on the close code received), and whether to tell `PersistentWS` to queue
    * a reconnect at all.
    */
  private persistentWSClose = (code: number): { retry: boolean } => {
    clearInterval(this.heartbeatTimer!)

    log(`WS CLOSED with code ${code}`)
    let retry = true

    if (this.performingManualReconnect) {
      log(`we are performingReconnect, letting PersistentWS retry (resuming afterwards, too? ${this.shouldResume})`)
      this.performingManualReconnect = false
    } else if (RECONNECT_AND_RESUME_CLOSE_CODES.includes(code)) {
      this.updateResumptionState(true)
    } else if (RECONNECT_DONT_RESUME_CLOSE_CODES.includes(code)) {
      this.updateResumptionState(false)
    } else {
      log(`not reconnecting; we were closed with code ${code}`)
      retry = false
    }

    this.onConnectionClosed?.(code)
    this.onChangedReadyState?.(false)
    return { retry }
  }

  private updateResumptionState = async (resume: boolean) => {
    this.shouldResume = resume

    if (!resume) {
      // Wipe this state, so it can't be used by accident. If you pass `false`
      // to this method, it's assumed that you want to dispose of the current
      // session.
      this.lastSequenceNumber = null
      this.resumeGatewayURL = null
      this.sessionID = null
    }
  }

  private persistentWSMessage = (data: WSData) => {
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
      if (message.s !== expectedSequenceNumber) {
        texts.error(`[discord/WSClient] sequence mismatch! expected: ${expectedSequenceNumber}, got ${message.s}`)
      }

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
        log('received RECONNECT, reconnecting...')
        this.reconnect({ wantsResume: true })
        break
      case OPCode.INVALID_SESSION: {
        const salvageable: boolean = message.d
        log(`received INVALID_SESSION (salvageable: ${salvageable}), reconnecting`)
        this.reconnect({ wantsResume: salvageable })
        break
      }
      case OPCode.HELLO:
        this.setupHeartbeat(message.d.heartbeat_interval)
        this.sendIdentifyOrResume()
        this.shouldResume = false
        break
      case OPCode.HEARTBEAT_ACK: {
        if (DEBUG) log('Got HEARTBEAT_ACK!')
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
        log(`Received send-only OPCode (${message.op})!`, message)
        break
      }

      // * Default

      default: {
        log(`Unhandled OPCode (${message.op})!`, message)
        break
      }
    }

    this.gatewayMessageHandler?.(message)
  }

  private setupHeartbeat = (interval: number) => {
    if (DEBUG) log(`heartbeat interval: ${interval}ms`)
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
    if (DEBUG) log(this.shouldResume ? 'sending RESUME' : 'sending IDENTIFY')

    let payload: GatewayMessage
    if (this.shouldResume) {
      if (DEBUG) log(`resuming soon; last seq: ${this.lastSequenceNumber}`)

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
    if (DEBUG) log('sending heartbeat...')

    if (!this.receivedHeartbeatAck) {
      log('connection zombified! tried to send heartbeat, but the last one wasn\'t acked')
      this.reconnect({ wantsResume: true })
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
        this.sessionID = message.d?.session_id
        this.resumeGatewayURL = message.d?.resume_gateway_url
        if (DEBUG) log(`we're READY! (session id: ${this.sessionID}, resume URL: ${this.resumeGatewayURL})`)
        this.onChangedReadyState?.(true)
        break
      }

      case GatewayMessageType.SESSIONS_REPLACE: {
        const session = message.d?.at(0)
        if (session.session_id) this.sessionID = session.session_id
        break
      }

      case GatewayMessageType.RESUMED: {
        log('RESUMED!')
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
        this.onChangedReadyState?.(true)
        break
      }

      default:
        break
    }
  }
}

export default WSClient
