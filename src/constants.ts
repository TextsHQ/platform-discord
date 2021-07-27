export enum MessageType {
  DEFAULT = 0,
  RECIPIENT_ADD = 1,
  RECIPIENT_REMOVE = 2,
  CALL = 3,
  CHANNEL_NAME_CHANGE = 4,
  CHANNEL_ICON_CHANGE = 5,
  CHANNEL_PINNED_MESSAGE = 6,
  GUILD_MEMBER_JOIN = 7,
  USER_PREMIUM_GUILD_SUBSCRIPTION = 8,
  USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_1 = 9,
  USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_2 = 10,
  USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_3 = 11,
  CHANNEL_FOLLOW_ADD = 12,
  GUILD_DISCOVERY_DISQUALIFIED = 14,
  GUILD_DISCOVERY_REQUALIFIED = 15,
  REPLY = 19,
  APPLICATION_COMMAND = 20,
}

export enum MessageEmbedType {
  ARTICLE = 'article',
  GIFV = 'gifv',
  IMAGE = 'image',
  LINK = 'link',
  RICH = 'rich',
  VIDEO = 'video',
}

export enum ChannelType {
  GUILD_TEXT = 0, // a text channel within a server
  DM = 1, // a direct message between users
  GUILD_VOICE = 2, // a voice channel within a server
  GROUP_DM = 3, // a direct message between multiple users
  GUILD_CATEGORY = 4, // an organizational category that contains up to 50 channels
  GUILD_NEWS = 5, // a channel that users can follow and crosspost into their own server
  GUILD_STORE = 6, // a channel in which game developers can sell their game on Discord
  GUILD_NEWS_THREAD = 10, // a temporary sub-channel within a GUILD_NEWS channel
  GUILD_PUBLIC_THREAD = 11, // a temporary sub-channel within a GUILD_TEXT channel
  GUILD_PRIVATE_THREAD = 12, // a temporary sub-channel within a GUILD_TEXT channel that is only viewable by those invited  and those with the MANAGE_THREADS permission
  GUILD_STAGE_VOICE = 13, // a voice channel for hosting events with an audience
}

export const IGNORED_CHANNEL_TYPES = [2, 4, 13]
