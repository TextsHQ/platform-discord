import { texts, ThreadType } from '@textshq/platform-sdk'
import { MessageType, ChannelType, EmbedType } from 'discord-api-types/v9'
import { USER_AGENT as DISCORD_USER_AGENT } from './discord-constants'
import { usesErlpack } from './packers'

export const USER_AGENT = usesErlpack ? DISCORD_USER_AGENT : texts.constants.USER_AGENT

export enum MessageActivityType {
  SPOTIFY = 3,
}

export enum ScienceEventType {
  dm_list_viewed = 'dm_list_viewed',
  ready_payload_received = 'ready_payload_received',
  channel_opened = 'channel_opened',
  guild_viewed = 'guild_viewed',
  ack_messages = 'ack_messages',
  member_list_viewed = 'member_list_viewed',
}

export const SUPPORTED_EMBED_TYPES: Set<EmbedType> = new Set([
  EmbedType.Article,
  EmbedType.Link,
  EmbedType.Video,
  EmbedType.Rich,
])

export const IGNORED_MESSAGE_TYPES: Set<MessageType> = new Set([
  // MessageType.UserPremiumGuildSubscription,
  // MessageType.UserPremiumGuildSubscriptionTier1,
  // MessageType.UserPremiumGuildSubscriptionTier2,
  // MessageType.UserPremiumGuildSubscriptionTier3,
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

export const THREAD_TYPES: (ThreadType | undefined)[] = [
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
