import type { OPCode } from './OPCode'

export enum MessageType {
  HELLO = 'HELLO', // Defines the heartbeat interval
  READY = 'READY', // Contains the initial state information
  RESUMED = 'RESUMED', // Response to Resume
  RECONNECT = 'RECONNECT', // Server is going away, client should reconnect to gateway and resume
  INVALID_SESSION = 'INVALID_SESSION', // Failure response to Identify or Resume or invalid active session
  APPLICATION_COMMAND_CREATE = 'APPLICATION_COMMAND_CREATE', // New Slash Command was created
  APPLICATION_COMMAND_UPDATE = 'APPLICATION_COMMAND_UPDATE', // Slash Command was updated
  APPLICATION_COMMAND_DELETE = 'APPLICATION_COMMAND_DELETE', // Slash Command was deleted
  CHANNEL_CREATE = 'CHANNEL_CREATE', // New guild channel created
  CHANNEL_UPDATE = 'CHANNEL_UPDATE', // Channel was updated
  CHANNEL_DELETE = 'CHANNEL_DELETE', // Channel was deleted
  CHANNEL_PINS_UPDATE = 'CHANNEL_PINS_UPDATE', // Message was pinned or unpinned
  THREAD_CREATE = 'THREAD_CREATE', // Thread created, also sent when being added to a private thread
  THREAD_UPDATE = 'THREAD_UPDATE', // Thread was updated
  THREAD_DELETE = 'THREAD_DELETE', // Thread was deleted
  THREAD_LIST_SYNC = 'THREAD_LIST_SYNC', // Sent when gaining access to a channel, contains all active threads in that channel
  THREAD_MEMBER_UPDATE = 'THREAD_MEMBER_UPDATE', // Thread member for the current user was updated
  THREAD_MEMBERS_UPDATE = 'THREAD_MEMBERS_UPDATE', // Some user(s) were added to or removed from a thread
  GUILD_CREATE = 'GUILD_CREATE', // Lazy-load for unavailable guild, guild became available, or user joined a new guild
  GUILD_UPDATE = 'GUILD_UPDATE', // Guild was updated
  GUILD_DELETE = 'GUILD_DELETE', // Guild became unavailable, or user left/was removed from a guild
  GUILD_BAN_ADD = 'GUILD_BAN_ADD', // User was banned from a guild
  GUILD_BAN_REMOVE = 'GUILD_BAN_REMOVE', // User was unbanned from a guild
  GUILD_EMOJIS_UPDATE = 'GUILD_EMOJIS_UPDATE', // Guild emojis were updated
  GUILD_INTEGRATIONS_UPDATE = 'GUILD_INTEGRATIONS_UPDATE', // Guild integration was updated
  GUILD_MEMBER_ADD = 'GUILD_MEMBER_ADD', // New user joined a guild
  GUILD_MEMBER_REMOVE = 'GUILD_MEMBER_REMOVE', // User was removed from a guild
  GUILD_MEMBER_UPDATE = 'GUILD_MEMBER_UPDATE', // Guild member was updated
  GUILD_MEMBERS_CHUNK = 'GUILD_MEMBERS_CHUNK', // Response to Request Guild Members
  GUILD_ROLE_CREATE = 'GUILD_ROLE_CREATE', // Guild role was created
  GUILD_ROLE_UPDATE = 'GUILD_ROLE_UPDATE', // Guild role was updated
  GUILD_ROLE_DELETE = 'GUILD_ROLE_DELETE', // Guild role was deleted
  GUILD_MEMBER_LIST_UPDATE = 'GUILD_MEMBER_LIST_UPDATE',
  INTEGRATION_CREATE = 'INTEGRATION_CREATE', // Guild integration was created
  INTEGRATION_UPDATE = 'INTEGRATION_UPDATE', // Guild integration was updated
  INTEGRATION_DELETE = 'INTEGRATION_DELETE', // Guild integration was deleted
  INTERACTION_CREATE = 'INTERACTION_CREATE', // User used an interaction, such as a Slash Command
  INVITE_CREATE = 'INVITE_CREATE', // Invite to a channel was created
  INVITE_DELETE = 'INVITE_DELETE', // Invite to a channel was deleted
  MESSAGE_CREATE = 'MESSAGE_CREATE', // Message was created
  MESSAGE_UPDATE = 'MESSAGE_UPDATE', // Message was edited
  MESSAGE_DELETE = 'MESSAGE_DELETE', // Message was deleted
  MESSAGE_DELETE_BULK = 'MESSAGE_DELETE_BULK', // Multiple messages were deleted at once
  MESSAGE_REACTION_ADD = 'MESSAGE_REACTION_ADD', // User reacted to a message
  MESSAGE_REACTION_REMOVE = 'MESSAGE_REACTION_REMOVE', // User removed a reaction from a message
  MESSAGE_REACTION_REMOVE_ALL = 'MESSAGE_REACTION_REMOVE_ALL', // All reactions were explicitly removed from a message
  MESSAGE_REACTION_REMOVE_EMOJI = 'MESSAGE_REACTION_REMOVE_EMOJI', // All reactions for a given emoji were explicitly removed from a message
  PRESENCE_UPDATE = 'PRESENCE_UPDATE', // User was updated
  TYPING_START = 'TYPING_START', // User started typing in a channel
  USER_UPDATE = 'USER_UPDATE', // Properties about the user changed
  VOICE_STATE_UPDATE = 'VOICE_STATE_UPDATE', // Someone joined, left, or moved a voice channel
  VOICE_SERVER_UPDATE = 'VOICE_SERVER_UPDATE', // Guild's voice server was updated
  WEBHOOKS_UPDATE = 'WEBHOOKS_UPDATE', // Guild channel webhook was created, update, or deleted
  CHANNEL_RECIPIENT_ADD = 'CHANNEL_RECIPIENT_ADD', // User added to a group DM
  CHANNEL_RECIPIENT_REMOVE = 'CHANNEL_RECIPIENT_REMOVE', // User removed from a group DM

  // * Undocumented

  _CHANNEL_PINS_ACK = 'CHANNEL_PINS_ACK', // Channel pins update has been read
  _CHANNEL_UNREAD_UPDATE = 'CHANNEL_UNREAD_UPDATE', // ???
  _GUILD_APPLICATION_COMMAND_COUNTS_UPDATE = 'GUILD_APPLICATION_COMMAND_COUNTS_UPDATE', // ???
  _MESSAGE_ACK = 'MESSAGE_ACK', // Message has been read
  _READY_SUPPLEMENTAL = 'READY_SUPPLEMENTAL', // Additional initial data, sent after 'READY'
  _RELATIONSHIP_ADD = 'RELATIONSHIP_ADD', // Friend invite was sent/accepted
  _RELATIONSHIP_REMOVE = 'RELATIONSHIP_REMOVE', // Friend was removed
  _SESSIONS_REPLACE = 'SESSIONS_REPLACE', // Dispatched when connected to gateway on top of another session (i.e. in Discord app)
}

/**
 * @typedef {Object} Message - Message from the gateway
 */
export interface Message<D> {
  /**
    * OPCode for the payload
    *
    * @type {OPCode | null}
    */
  op: OPCode | null

  /**
    * JSON event data
    *
    * @type {D | undefined}
    */
  d?: D

  /**
    * Sequence number, used for resuming sessions and heartbeats
    *
    * @type {number | undefined}
    */
  s?: number

  /**
    * The event name for this payload
    *
    * @type {MessageType | undefined}
    */
  t?: MessageType
}
