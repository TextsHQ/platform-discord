import type { Snowflake } from 'discord-api-types/globals'
import type {
  APIUser,
  APIGuild,
  APIChannel,
  GatewayGuildEmojisUpdateDispatchData,
  APIMessage,
  GatewayMessageDeleteBulkDispatchData,
  GatewayTypingStartDispatchData,
  GatewayChannelCreateDispatchData,
  GatewayChannelUpdateDispatchData,
  GatewayChannelDeleteDispatchData,
  GatewayMessageReactionAddDispatchData,
  GatewayMessageReactionRemoveEmojiDispatchData,
  GatewayMessageReactionRemoveDispatchData,
  GatewayMessageReactionRemoveAllDispatchData,
  PresenceUpdateStatus,
  GatewayActivityUpdateData,
} from 'discord-api-types/v9'
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
    op: OPCode.DISPATCH

    /**
     * The enclosed event data contained within this Gateway packet.
     */
    d: Data

    /**
     * Packet sequence number, which is used for resuming sessions and heartbeats.
     *
     * This number is incremented by the gateway with every event sent, and can
     * be used in the event that the connection is unexpectedly severed---the
     * gateway will use the sequence number as a reference point in order to send
     * us all of the events that we missed.
     */
    s: number

    /**
     * The event name for this gateway message (only relevant if `op` is
     * `DISPATCH`). For low-level events, see the {@link op} field.
     */
    t: GatewayMessageType
  }
  | {
    op: OPCode
    d: Data

    // The sequence number and event name fields are always (supposed to be)
    // `null` when `op` isn't `DISPATCH`.
    s: null
    t: null
  }

export type OutboundGatewayMessage = Pick<GatewayMessage<any>, 'op' | 'd'>

/**
  * A single `DISPATCH` packet received from the Discord Gateway with a known
  * event data type. Prefer this type over `GatewayMessage` whenever possible.
  */
export type DispatchMessage<MessageType extends keyof EventData> = {
  op: OPCode.DISPATCH

  /**
    * The event data associated with this Gateway message. This is different
    * depending on the {@link MessageType}.
    */
  d: EventData[MessageType]

  s: number

  t: MessageType
}

/** A guild with channels included within. */
type GuildWithChannels = APIGuild & {
  channels: APIChannel[]
  threads: APIChannel[]
}

/** A message received from the Gateway, but with fun data that only users get. */
type UserAPIMessage = APIMessage & {
  guild_id: Snowflake

  // Override `string | number`.
  nonce: string
}

type UserAPIPresenceBase = {
  activities: GatewayActivityUpdateData[]
  status: PresenceUpdateStatus
  client_status: {
    desktop?: PresenceUpdateStatus
    web?: PresenceUpdateStatus
    // might be more possible fields ...
  }
}

/**
  * Our assumed types of event data contained within dispatch messages from the
  * Gateway, keyed by the Gateway message type (the `t` field). This type is
  * used in conjunction with `DispatchMessage` in order to provide stronger
  * type guarantees.
  *
  * Because the user API surface is private and potentially unstable, diligent
  * care must be taken in order to ensure that we don't crash and burn at
  * runtime.
  */
export type EventData = {
  // TODO: Verify.
  [GatewayMessageType.READY]: {
    analytics_token: string

    read_state: {
      entries: Array<{ id: Snowflake, last_message_id: Snowflake }>
    }

    user: { premium_type?: number }
    users: APIUser[]

    guilds: GuildWithChannels[]

    user_guild_settings: {
      entries: Array<{
        channel_overrides: Array<{ muted: boolean, channel_id: string }>
      }>
    }

    session_id: string
  }

  [GatewayMessageType.READY_SUPPLEMENTAL]: {
    merged_presences: {
      friends?: Array<UserAPIPresenceBase & { user_id: Snowflake }>
    }
  }

  [GatewayMessageType.GUILD_CREATE]: GuildWithChannels
  [GatewayMessageType.GUILD_DELETE]: GuildWithChannels
  [GatewayMessageType.GUILD_EMOJIS_UPDATE]: GatewayGuildEmojisUpdateDispatchData

  // TODO: Verify.
  [GatewayMessageType.MESSAGE_CREATE]: UserAPIMessage
  [GatewayMessageType.MESSAGE_UPDATE]: UserAPIMessage
  [GatewayMessageType.MESSAGE_DELETE]: UserAPIMessage
  [GatewayMessageType.MESSAGE_DELETE_BULK]: GatewayMessageDeleteBulkDispatchData
  [GatewayMessageType.MESSAGE_ACK]: {
    guild_id: Snowflake
    channel_id: Snowflake
    message_id: Snowflake
    ack_type: number
  }

  [GatewayMessageType.TYPING_START]: GatewayTypingStartDispatchData

  [GatewayMessageType.CHANNEL_CREATE]: GatewayChannelCreateDispatchData
  [GatewayMessageType.CHANNEL_UPDATE]: GatewayChannelUpdateDispatchData
  [GatewayMessageType.CHANNEL_DELETE]: GatewayChannelDeleteDispatchData

  [GatewayMessageType.MESSAGE_REACTION_ADD]: GatewayMessageReactionAddDispatchData
  [GatewayMessageType.MESSAGE_REACTION_REMOVE_EMOJI]: GatewayMessageReactionRemoveEmojiDispatchData
  [GatewayMessageType.MESSAGE_REACTION_REMOVE]: GatewayMessageReactionRemoveDispatchData
  [GatewayMessageType.MESSAGE_REACTION_REMOVE_ALL]: GatewayMessageReactionRemoveAllDispatchData

  [GatewayMessageType.PRESENCE_UPDATE]: UserAPIPresenceBase & {
    user: { id: Snowflake }
    guild_id: Snowflake
    broadcast: unknown
  }

  [GatewayMessageType.CHANNEL_RECIPIENT_ADD]: { channel_id: Snowflake, user: APIUser }
  [GatewayMessageType.CHANNEL_RECIPIENT_REMOVE]: { channel_id: Snowflake }

  [GatewayMessageType.RELATIONSHIP_ADD]: { id: Snowflake, user: APIUser }
  [GatewayMessageType.RELATIONSHIP_REMOVE]: { id: Snowflake }
}

export interface GatewayConnectionOptions {
  version: number
  encoding: string
  compress?: string
}
