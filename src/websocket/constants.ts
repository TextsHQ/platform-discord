// https://discord.com/developers/docs/topics/opcodes-and-status-codes#gateway-gateway-opcodes
export enum OPCode {
  DISPATCH = 0, // Receive: An event was dispatched.
  HEARTBEAT = 1, // Send/Recieve: Fired periodically by the client to keep the connection alive.
  IDENTIFY = 2, // Send: Starts a new session during the initial handshake.
  PRESENCE_UPDATE = 3, // Send: Update the client's presence.
  VOICE_STATE_UPDATE = 4, // Send: Used to join/leave or move between voice channels.
  // 5 is undefined
  RESUME = 6, // Send: Resume a previous session that was disconnected.
  RECONNECT = 7, // Recieve: You should attempt to reconnect and resume immediately.
  REQUEST_GUILD_MEMBERS = 8, // Send: Request information about offline guild members in a large guild.
  INVALID_SESSION = 9, // Recieve: The session has been invalidated. You should reconnect and identify/resume accordingly.
  HELLO = 10, // Recieve: Sent immediately after connecting, contains the heartbeat_interval to use.
  HEARTBEAT_ACK = 11, // Recieve: Sent in response to receiving a heartbeat to acknowledge that it has been received.
}

export enum DiscordPresenceStatus {
  ONLINE = 'online',
  DND = 'dnd',
  IDLE = 'idle',
  INVISIBLE = 'invisible',
  OFFLINE = 'offline',
}

export enum GatewayMessageType {
  HELLO = 'HELLO', // defines the heartbeat interval
  READY = 'READY', // contains the initial state information
  RESUMED = 'RESUMED', // response to Resume
  RECONNECT = 'RECONNECT', // server is going away, client should reconnect to gateway and resume
  INVALID_SESSION = 'INVALID_SESSION', // failure response to Identify or Resume or invalid active session
  APPLICATION_COMMAND_CREATE = 'APPLICATION_COMMAND_CREATE', // new Slash Command was created
  APPLICATION_COMMAND_UPDATE = 'APPLICATION_COMMAND_UPDATE', // Slash Command was updated
  APPLICATION_COMMAND_DELETE = 'APPLICATION_COMMAND_DELETE', // Slash Command was deleted
  CHANNEL_CREATE = 'CHANNEL_CREATE', // new guild channel created
  CHANNEL_UPDATE = 'CHANNEL_UPDATE', // channel was updated
  CHANNEL_DELETE = 'CHANNEL_DELETE', // channel was deleted
  CHANNEL_PINS_UPDATE = 'CHANNEL_PINS_UPDATE', // message was pinned or unpinned
  THREAD_CREATE = 'THREAD_CREATE', // thread created, also sent when being added to a private thread
  THREAD_UPDATE = 'THREAD_UPDATE', // thread was updated
  THREAD_DELETE = 'THREAD_DELETE', // thread was deleted
  THREAD_LIST_SYNC = 'THREAD_LIST_SYNC', // sent when gaining access to a channel, contains all active threads in that channel
  THREAD_MEMBER_UPDATE = 'THREAD_MEMBER_UPDATE', // thread member for the current user was updated
  THREAD_MEMBERS_UPDATE = 'THREAD_MEMBERS_UPDATE', // some user(s) were added to or removed from a thread
  GUILD_CREATE = 'GUILD_CREATE', // lazy-load for unavailable guild, guild became available, or user joined a new guild
  GUILD_UPDATE = 'GUILD_UPDATE', // guild was updated
  GUILD_DELETE = 'GUILD_DELETE', // guild became unavailable, or user left/was removed from a guild
  GUILD_BAN_ADD = 'GUILD_BAN_ADD', // user was banned from a guild
  GUILD_BAN_REMOVE = 'GUILD_BAN_REMOVE', // user was unbanned from a guild
  GUILD_EMOJIS_UPDATE = 'GUILD_EMOJIS_UPDATE', // guild emojis were updated
  GUILD_INTEGRATIONS_UPDATE = 'GUILD_INTEGRATIONS_UPDATE', // guild integration was updated
  GUILD_MEMBER_ADD = 'GUILD_MEMBER_ADD', // new user joined a guild
  GUILD_MEMBER_REMOVE = 'GUILD_MEMBER_REMOVE', // user was removed from a guild
  GUILD_MEMBER_UPDATE = 'GUILD_MEMBER_UPDATE', // guild member was updated
  GUILD_MEMBERS_CHUNK = 'GUILD_MEMBERS_CHUNK', // response to Request Guild Members
  GUILD_ROLE_CREATE = 'GUILD_ROLE_CREATE', // guild role was created
  GUILD_ROLE_UPDATE = 'GUILD_ROLE_UPDATE', // guild role was updated
  GUILD_ROLE_DELETE = 'GUILD_ROLE_DELETE', // guild role was deleted
  INTEGRATION_CREATE = 'INTEGRATION_CREATE', // guild integration was created
  INTEGRATION_UPDATE = 'INTEGRATION_UPDATE', // guild integration was updated
  INTEGRATION_DELETE = 'INTEGRATION_DELETE', // guild integration was deleted
  INTERACTION_CREATE = 'INTERACTION_CREATE', // user used an interaction, such as a Slash Command
  INVITE_CREATE = 'INVITE_CREATE', // invite to a channel was created
  INVITE_DELETE = 'INVITE_DELETE', // invite to a channel was deleted
  MESSAGE_CREATE = 'MESSAGE_CREATE', // message was created
  MESSAGE_UPDATE = 'MESSAGE_UPDATE', // message was edited
  MESSAGE_DELETE = 'MESSAGE_DELETE', // message was deleted
  MESSAGE_DELETE_BULK = 'MESSAGE_DELETE_BULK', // multiple messages were deleted at once
  MESSAGE_REACTION_ADD = 'MESSAGE_REACTION_ADD', // user reacted to a message
  MESSAGE_REACTION_REMOVE = 'MESSAGE_REACTION_REMOVE', // user removed a reaction from a message
  MESSAGE_REACTION_REMOVE_ALL = 'MESSAGE_REACTION_REMOVE_ALL', // all reactions were explicitly removed from a message
  MESSAGE_REACTION_REMOVE_EMOJI = 'MESSAGE_REACTION_REMOVE_EMOJI', // all reactions for a given emoji were explicitly removed from a message
  PRESENCE_UPDATE = 'PRESENCE_UPDATE', // user was updated
  TYPING_START = 'TYPING_START', // user started typing in a channel
  USER_UPDATE = 'USER_UPDATE', // properties about the user changed
  VOICE_STATE_UPDATE = 'VOICE_STATE_UPDATE', // someone joined, left, or moved a voice channel
  VOICE_SERVER_UPDATE = 'VOICE_SERVER_UPDATE', // guild's voice server was updated
  WEBHOOKS_UPDATE = 'WEBHOOKS_UPDATE', // guild channel webhook was created, update, or deleted

  // Undocumented
  CHANNEL_PINS_ACK = 'CHANNEL_PINS_ACK', // channel pins update has been read
  CHANNEL_UNREAD_UPDATE = 'CHANNEL_UNREAD_UPDATE', // ???
  MESSAGE_ACK = 'MESSAGE_ACK', // message has been read
  READY_SUPPLEMENTAL = 'READY_SUPPLEMENTAL', // ???
  RELATIONSHIP_ADD = 'RELATIONSHIP_ADD', // friend invite was sent/accepted
  RELATIONSHIP_REMOVE = 'RELATIONSHIP_REMOVE', // friend was removed
  SESSIONS_REPLACE = 'SESSIONS_REPLACE', // dispatched when connected to gateway on top of another session (i.e. in Discord app)
}

export enum GatewayCloseCode {
  RECONNECT_REQUESTED = 1001,
  DISCONNECTED = 1005,
  ADDRESS_NOT_FOUND = 1006,
  UNKNOWN_ERROR = 4000,
  UNKNOWN_OPCODE = 4001,
  DECODE_ERROR = 4002,
  NOT_AUTHENTICATED = 4003,
  AUTHENTICATION_FAILED = 4004,
  ALREADY_AUTHENTICATED = 4005,
  INVALID_SEQ = 4007,
  RATE_LIMITED = 4008,
  SESSION_TIMED_OUT = 4009,
  INVALID_API_VERSION = 4012,
  INVALID_INTENTS = 4013,
  DISALLOWED_INTENTS = 4014,
}
