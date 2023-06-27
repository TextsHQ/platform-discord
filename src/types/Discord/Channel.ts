import { User } from './User'

export enum ChannelType {
  GUILD_TEXT = 0, // a text channel within a server
  DM = 1, // a direct message between users
  GUILD_VOICE = 2, // a voice channel within a server
  GROUP_DM = 3, // a direct message between multiple users
  GUILD_CATEGORY = 4, // an organizational category that contains up to 50 channels
  GUILD_ANNOUNCEMENT = 5, // a channel that users can follow and crosspost into their own server (formerly news channels)
  ANNOUNCEMENT_THREAD = 10, // a temporary sub-channel within a GUILD_ANNOUNCEMENT channel
  PUBLIC_THREAD = 11, // a temporary sub-channel within a GUILD_TEXT or GUILD_FORUM channel
  PRIVATE_THREAD = 12, // a temporary sub-channel within a GUILD_TEXT channel that is only viewable by those invited and those with the MANAGE_THREADS permission
  GUILD_STAGE_VOICE = 13, // a voice channel for hosting events with an audience
  GUILD_DIRECTORY = 14, // the channel in a hub containing the listed servers
  GUILD_FORUM = 15, // Channel that can only contain threads
}

export interface Channel {
  id: string
  type: ChannelType
  last_message_id?: string
  // flags: number
  last_pin_timestamp?: string
  recipients: User[]
  name?: string
  icon?: string
  topic?: string
  permission_overwrites?: {
    type: number
    id: string
    deny: string
    allow: string
  }[]
  // parent_id?: string
  icon_emoji: any[]
  // flags: number
  guild_id?: string
}
