// https://discord.com/developers/docs/topics/opcodes-and-status-codes#gateway-gateway-opcodes
export enum OPCode {
  Dispatch = 0, // Receive: An event was dispatched.
  Heartbeat = 1, // Send/Recieve: Fired periodically by the client to keep the connection alive.
  Identify = 2, // Send: Starts a new session during the initial handshake.
  PresenceUpdate = 3, // Send: Update the client's presence.
  VoiceStateUpdate = 4, // Send: Used to join/leave or move between voice channels.
  // 5 is undefined
  Resume = 6, // Send: Resume a previous session that was disconnected.
  Reconnect = 7, // Recieve: You should attempt to reconnect and resume immediately.
  RequestGuildMembers = 8, // Send: Request information about offline guild members in a large guild.
  InvalidSession = 9, // Recieve: The session has been invalidated. You should reconnect and identify/resume accordingly.
  Hello = 10, // Recieve: Sent immediately after connecting, contains the heartbeat_interval to use.
  HearbeatAck = 11, // Recieve: Sent in response to receiving a heartbeat to acknowledge that it has been received.

  // * Undocumented

  _LazyRequest = 14, // https://arandomnewaccount.gitlab.io/discord-unofficial-docs/lazy_guilds.html#op-14-lazy-request-what-to-send
}
