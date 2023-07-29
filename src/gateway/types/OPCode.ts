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

  // * Undocumented

  _LAZY_REQUEST = 14, // https://arandomnewaccount.gitlab.io/discord-unofficial-docs/lazy_guilds.html#op-14-lazy-request-what-to-send
}
