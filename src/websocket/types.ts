import type { OPCode, GatewayMessageType } from './constants'

/**
 * A single packet received from the Discord Gateway, which is a WebSocket
 * service that distributes realtime events and data to clients.
 *
 * See: https://discord.com/developers/docs/topics/gateway
 */
export interface GatewayMessage {
  /**
   * A code denoting the meaning of this message.
   *
   * Most codes concern themselves with presence updates or heartbeating. The
   * vast majority of realtime events that are received have an `op` of `READY`,
   * with the `t` field actually denoting the event type of interest.
   */
  op: OPCode

  /**
   * Data associated with this Gateway packet.
   */
  d?: any

  /**
   * Packet sequence number, which is used for resuming sessions and heartbeats.
   *
   * This number is incremented by the gateway with every event sent, and can
   * be used in the event that the connection is unexpectedly severed---the
   * gateway will use the sequence number as a reference point in order to send
   * us all of the events that we missed.
   */
  s?: number

  /**
   * The event name for this gateway message (only relevant if `op` is
   * `DISPATCH`). For low-level events, see the {@link op} field.
   */
  t?: GatewayMessageType
}

export interface GatewayConnectionOptions {
  version: number
  encoding: string
  compress?: string
}
