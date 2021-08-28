import type { ThreadType } from '@textshq/platform-sdk'
import { MessageType, ChannelType, EmbedType } from 'discord-api-types/v9'

export enum MessageActivityType {
  SPOTIFY = 3,
}

export const SUPPORTED_EMBED_TYPES: Set<EmbedType> = new Set([
  EmbedType.Article,
  EmbedType.Link,
  EmbedType.Video,
  EmbedType.Rich,
])

export const IGNORED_MESSAGE_TYPES: Set<MessageType> = new Set([
  MessageType.UserPremiumGuildSubscription,
  MessageType.UserPremiumGuildSubscriptionTier1,
  MessageType.UserPremiumGuildSubscriptionTier2,
  MessageType.UserPremiumGuildSubscriptionTier3,
  MessageType.ChannelFollowAdd,
  MessageType.GuildDiscoveryDisqualified,
  MessageType.GuildDiscoveryRequalified,
])

export const IGNORED_CHANNEL_TYPES: Set<ChannelType> = new Set([
  ChannelType.GuildVoice,
  ChannelType.GuildCategory,
  ChannelType.GuildStageVoice,
])

// https://discord.com/developers/docs/resources/channel#message-object-message-sticker-format-types
export enum StickerFormat {
  PNG = 1,
  APNG = 2,
  LOTTIE = 3,
}

export const THREAD_TYPES: ThreadType[] = [
  'channel', // GUILD_TEXT
  'single', // DM
  'channel', // GUILD_VOICE
  'group', // GROUP_DM
  'channel', // GUILD_CATEGORY
  'broadcast', // GUILD_NEWS
  'broadcast', // GUILD_STORE,
  undefined,
  undefined,
  undefined,
  'broadcast', // GUILD_NEWS_THREAD
  'channel', // GUILD_PUBLIC_THREAD
  'channel', // GUILD_PRIVATE_THREAD,
  undefined, // GUILD_STAGE_VOICE
]
