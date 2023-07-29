import { MessageReaction, Sticker, User } from '@/types/Discord'

export type MessageAttachment = {
  id: string
  filename: string
  size: number
  url: string
  proxy_url?: string
  width: number
  height: number
  content_type: string
}

export enum MessageEmbedType {
  RICH = 'rich',
  ARTICLE = 'article',
  IMAGE = 'image',
  VIDEO = 'video',
}

export type MessageEmbedMedia = {
  url: string
  proxy_url?: string
  width?: number
  height?: number
}

export type MessageEmbed = {
  type: MessageEmbedType
  url: string
  title: string
  description?: string
  timestamp?: string
  provider?: {
    name?: string
  }
  image?: MessageEmbedMedia
  thumbnail?: MessageEmbedMedia
  video?: MessageEmbedMedia
  fields?: {
    name: string
    value: string
    inline: boolean
  }[]
}

export enum MessageType {
  DEFAULT = 0,
  RECIPIENT_ADD = 1,
  RECIPIENT_REMOVE = 2,
  CALL = 3,
  CHANNEL_NAME_CHANGE = 4,
  CHANNEL_ICON_CHANGE = 5,
  CHANNEL_PINNED_MESSAGE = 6,
  USER_JOIN = 7,
  GUILD_BOOST = 8,
  GUILD_BOOST_TIER_1 = 9,
  GUILD_BOOST_TIER_2 = 10,
  GUILD_BOOST_TIER_3 = 11,
  CHANNEL_FOLLOW_ADD = 12,
  GUILD_DISCOVERY_DISQUALIFIED = 14,
  GUILD_DISCOVERY_REQUALIFIED = 15,
  GUILD_DISCOVERY_GRACE_PERIOD_INITIAL_WARNING = 16,
  GUILD_DISCOVERY_GRACE_PERIOD_FINAL_WARNING = 17,
  THREAD_CREATED = 18,
  REPLY = 19,
  CHAT_INPUT_COMMAND = 20,
  THREAD_STARTER_MESSAGE = 21,
  GUILD_INVITE_REMINDER = 22,
  CONTEXT_MENU_COMMAND = 23,
  AUTO_MODERATION_ACTION = 24,
  ROLE_SUBSCRIPTION_PURCHASE = 25,
  INTERACTION_PREMIUM_UPSELL = 26,
  STAGE_START = 27,
  STAGE_END = 28,
  STAGE_SPEAKER = 29,
  STAGE_TOPIC = 31,
  GUILD_APPLICATION_PREMIUM_SUBSCRIPTION = 32,
}

export type Message = {
  id: string
  type: MessageType
  content: string
  channel_id: string
  author: User
  attachments: MessageAttachment[]
  embeds?: MessageEmbed[]
  mentions?: User[]
  // mention_roles: [],
  pinned: boolean
  mention_everyone: boolean
  // tts: boolean
  timestamp: string
  edited_timestamp?: string
  // flags: 0,
  // components: []
  reactions?: MessageReaction[]
  sticker_items?: Sticker[]
  message_reference?: {
    channel_id: string
    message_id: string
  }
  referenced_message?: Message
  nonce?: string
}
