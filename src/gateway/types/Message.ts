import type { OPCode } from './OPCode'

export enum MessageType {
  Hello = 'HELLO', // Defines the heartbeat interval
  Ready = 'READY', // Contains the initial state information
  Resumed = 'RESUMED', // Response to Resume
  Reconnect = 'RECONNECT', // Server is going away, client should reconnect to gateway and resume
  InvalidSession = 'INVALID_SESSION', // Failure response to Identify or Resume or invalid active session
  ApplicationCommandCreate = 'APPLICATION_COMMAND_CREATE', // New Slash Command was created
  ApplicationCommandUpdate = 'APPLICATION_COMMAND_UPDATE', // Slash Command was updated
  ApplicationCommandDelete = 'APPLICATION_COMMAND_DELETE', // Slash Command was deleted
  ChannelCreate = 'CHANNEL_CREATE', // New guild channel created
  ChannelUpdate = 'CHANNEL_UPDATE', // Channel was updated
  ChannelDelete = 'CHANNEL_DELETE', // Channel was deleted
  ChannelPinsUpdate = 'CHANNEL_PINS_UPDATE', // Message was pinned or unpinned
  ThreadCreate = 'THREAD_CREATE', // Thread created, also sent when being added to a private thread
  ThreadUpdate = 'THREAD_UPDATE', // Thread was updated
  ThreadDelete = 'THREAD_DELETE', // Thread was deleted
  ThreadListSync = 'THREAD_LIST_SYNC', // Sent when gaining access to a channel, contains all active threads in that channel
  ThreadMemberUpdate = 'THREAD_MEMBER_UPDATE', // Thread member for the current user was updated
  ThreadMembersUpdate = 'THREAD_MEMBERS_UPDATE', // Some user(s) were added to or removed from a thread
  GuildCreate = 'GUILD_CREATE', // Lazy-load for unavailable guild, guild became available, or user joined a new guild
  GuildUpdate = 'GUILD_UPDATE', // Guild was updated
  GuildDelete = 'GUILD_DELETE', // Guild became unavailable, or user left/was removed from a guild
  GuildBanAdd = 'GUILD_BAN_ADD', // User was banned from a guild
  GuildBanRemove = 'GUILD_BAN_REMOVE', // User was unbanned from a guild
  GuildEmojisUpdate = 'GUILD_EMOJIS_UPDATE', // Guild emojis were updated
  GuildIntegrationsUpdate = 'GUILD_INTEGRATIONS_UPDATE', // Guild integration was updated
  GuildMemberAdd = 'GUILD_MEMBER_ADD', // New user joined a guild
  GuildMemberRemove = 'GUILD_MEMBER_REMOVE', // User was removed from a guild
  GuildMemberUpdate = 'GUILD_MEMBER_UPDATE', // Guild member was updated
  GuildMembersChunk = 'GUILD_MEMBERS_CHUNK', // Response to Request Guild Members
  GuildRoleCreate = 'GUILD_ROLE_CREATE', // Guild role was created
  GuildRoleUpdate = 'GUILD_ROLE_UPDATE', // Guild role was updated
  GuildRoleDelete = 'GUILD_ROLE_DELETE', // Guild role was deleted
  GuildMemberListUpdate = 'GUILD_MEMBER_LIST_UPDATE',
  IntegrationCreate = 'INTEGRATION_CREATE', // Guild integration was created
  IntegrationUpdate = 'INTEGRATION_UPDATE', // Guild integration was updated
  IntegrationDelete = 'INTEGRATION_DELETE', // Guild integration was deleted
  InteractionCreate = 'INTERACTION_CREATE', // User used an interaction, such as a Slash Command
  InviteCreate = 'INVITE_CREATE', // Invite to a channel was created
  InviteDelete = 'INVITE_DELETE', // Invite to a channel was deleted
  MessageCreate = 'MESSAGE_CREATE', // Message was created
  MessageUpdate = 'MESSAGE_UPDATE', // Message was edited
  MessageDelete = 'MESSAGE_DELETE', // Message was deleted
  MessageDeleteBulk = 'MESSAGE_DELETE_BULK', // Multiple messages were deleted at once
  MessageReactionAdd = 'MESSAGE_REACTION_ADD', // User reacted to a message
  MessageReactionRemove = 'MESSAGE_REACTION_REMOVE', // User removed a reaction from a message
  MessageReactionRemoveAll = 'MESSAGE_REACTION_REMOVE_ALL', // All reactions were explicitly removed from a message
  MessageReactionRemoveEmoji = 'MESSAGE_REACTION_REMOVE_EMOJI', // All reactions for a given emoji were explicitly removed from a message
  PresenceUpdate = 'PRESENCE_UPDATE', // User was updated
  TypingStart = 'TYPING_START', // User started typing in a channel
  UserUpdate = 'USER_UPDATE', // Properties about the user changed
  VoiceStateUpdate = 'VOICE_STATE_UPDATE', // Someone joined, left, or moved a voice channel
  VoiceServerUpdate = 'VOICE_SERVER_UPDATE', // Guild's voice server was updated
  WebhooksUpdate = 'WEBHOOKS_UPDATE', // Guild channel webhook was created, update, or deleted
  ChannelRecipientAdd = 'CHANNEL_RECIPIENT_ADD', // User added to a group DM
  ChannelRecipientRemove = 'CHANNEL_RECIPIENT_REMOVE', // User removed from a group DM

  // * Undocumented

  _ChannelPinsAck = 'CHANNEL_PINS_ACK', // Channel pins update has been read
  _ChannelUnreadUpdate = 'CHANNEL_UNREAD_UPDATE', // ???
  _GuildApplicationCommandCountsUpdate = 'GUILD_APPLICATION_COMMAND_COUNTS_UPDATE', // ???
  _MessageAck = 'MESSAGE_ACK', // Message has been read
  _ReadySupplemental = 'READY_SUPPLEMENTAL', // Additional initial data, sent after 'READY'
  _RelationshipAdd = 'RELATIONSHIP_ADD', // Friend invite was sent/accepted
  _RelationshipRemove = 'RELATIONSHIP_REMOVE', // Friend was removed
  _SessionsReplace = 'SESSIONS_REPLACE', // Dispatched when connected to gateway on top of another session (i.e. in Discord app)
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
