import { OPCode, GatewayMessageType } from './constants'

/**
 * @typedef {Object} GatewayMessage - Message from the gateway
 */
export interface GatewayMessage {
  /**
    * OPCode for the payload
    *
    * @type {OPCode}
    */
  op: OPCode

  /**
    * JSON event data
    *
    * @type {any | undefined}
    */
  d?: any

  /**
    * Sequence number, used for resuming sessions and heartbeats
    *
    * @type {number | undefined}
    */
  s?: number

  /**
    * The event name for this payload
    *
    * @type {GatewayMessageType | undefined}
    */
  t?: GatewayMessageType
}
