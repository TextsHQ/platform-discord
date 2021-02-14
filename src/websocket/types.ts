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

/**
 * @typedef {Object} DiscordUser - Discord user
 */
export interface DiscordUser {
  /**
    * Avatar hash
    * Fetched from https://cdn.discordapp.com/avatars/${user_id}/${user_avatar}.png
    * If animated, starts with 'a_'
    *
    * @type {string | null}
    */
  avatar: string | null

  /**
    * Username # identifier
    *
    * @type {string}
    */
  discriminator: string

  /**
    * User email
    *
    * @type {string | null}
    */
  email: string | null

  /**
    * User flags
    *
    * @type {number | null}
    */
  flags: number | null

  /**
    * User identifier
    *
    * @type {string}
    */
  id: string

  /**
    * Is multifaction authorization enabled?
    *
    * @type {boolean | null}
    */
  mfa_enabled: boolean | null

  /**
    * Is user account premium?
    *
    * @type {boolean}
    */
  premium: boolean

  /**
    * Username
    *
    * @type {string}
    */
  username: string

  /**
    * Does this account has a verified phone number/email?
    *
    * @type {boolean | null}
    */
  verified: boolean | null
}
