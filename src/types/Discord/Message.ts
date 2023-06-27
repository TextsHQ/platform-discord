import { User } from './User'

export enum MessageType {
  Default,
  RecipientAdd,
  RecipientRemove,
  Call,
  ChannelNameChange,
  ChannelIconChange,
  ChannelPinnedMessage,
  GuildMemberJoin,
  UserPremiumGuildSubscription,
  UserPremiumGuildSubscriptionTier1,
  UserPremiumGuildSubscriptionTier2,
  UserPremiumGuildSubscriptionTier3,
  ChannelFollowAdd,
  GuildDiscoveryDisqualified = 14,
  GuildDiscoveryRequalified,
  GuildDiscoveryGracePeriodInitialWarning,
  GuildDiscoveryGracePeriodFinalWarning,
  Reply = 19,
  ChatInputCommand,
  GuildInviteReminder = 22,
  ContextMenuCommand,
}

export interface Message {
  id: string
  type: MessageType
  content: string
  channel_id: string
  author: User
  // attachments: []
  // embeds: [],
  mentions?: User[]
  // mention_roles: [],
  pinned: boolean
  mention_everyone: boolean
  // tts: boolean
  timestamp: string
  edited_timestamp?: string
  // flags: 0,
  // components: []
  message_reference?: {
    channel_id: string
    message_id: string
  }
  referenced_message?: Message
}
