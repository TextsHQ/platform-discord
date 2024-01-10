import type { OPCode, GatewayMessageType } from './constants'

/**
 * A single packet received as-is from the Discord Gateway - a WebSocket
 * service that distributes realtime events and data to clients.
 *
 * See: https://discord.com/developers/docs/topics/gateway
 */
export type GatewayMessage<Data = unknown> =
  | {
    /**
     * A code denoting the meaning of this message.
     *
     * Most codes concern themselves with events related to connection
     * lifecycle and general bringup. The vast majority of realtime events that
     * are received have an `op` of `DISPATCH`, with the `t` field actually
     * denoting the event type of interest.
     */
    op: OPCode.DISPATCH,

    /**
     * The enclosed event data contained within this Gateway packet.
     */
    d: Data,

    /**
     * Packet sequence number, which is used for resuming sessions and heartbeats.
     *
     * This number is incremented by the gateway with every event sent, and can
     * be used in the event that the connection is unexpectedly severed---the
     * gateway will use the sequence number as a reference point in order to send
     * us all of the events that we missed.
     */
    s: number,

    /**
     * The event name for this gateway message (only relevant if `op` is
     * `DISPATCH`). For low-level events, see the {@link op} field.
     */
    t: GatewayMessageType
  }
  | {
    op: OPCode,
    d: Data,

    // The sequence number and event name fields are always (supposed to be)
    // `null` when `op` isn't `DISPATCH`.
    s: null,
    t: null
  }

export type OutboundGatewayMessage = Pick<GatewayMessage<any>, "op" | "d">

export interface GatewayConnectionOptions {
  version: number
  encoding: string
  compress?: string
}
