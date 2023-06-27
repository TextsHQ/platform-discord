import { CustomEmoji } from './CustomEmoji'

export enum GuildChannelType {
  Default = 0,

  Category = 4,
}

export interface GuildChannel {
  // version: number
  type: GuildChannelType
  topic?: string
  // rate_limit_per_user: number
  // position: number
  permission_overwrites: {
    type: number
    id: string
    deny: string
    allow: string
  }[]
  // parent_id?: string
  name: string
  last_message_id?: string
  id: string
  icon_emoji: any[]
  // flags: number
  guild_id?: string
}

export interface GuildRole {
  // version: number
  unicode_emoji?: string
  // tags: any
  // position: number
  // permissions: string
  name: string
  mentionable: boolean
  // managed: boolean
  id: string
  icon?: string
  // hoist: boolean
  // flags: number
  // color: number
}

export interface Guild {
  // guild_hashes: {
  //   version: 1,
  //   roles: [Object],
  //   metadata: [Object],
  //   channels: [Object]
  // },
  // joined_at: string
  // explicit_content_filter: number
  features: string[]
  // premium_subscription_count: number
  // verification_level: number
  // nsfw_level: number
  lazy: boolean
  description?: string
  id: string
  // large: boolean
  // member_count: number
  icon?: string
  // public_updates_channel_id?: string
  // max_video_channel_users: number
  // system_channel_flags: number
  // guild_scheduled_events: any[]
  // discovery_splash?: any
  // banner?: any
  // max_members: number
  threads: any[]
  // premium_tier: number
  // safety_alerts_channel_id?: string
  // nsfw: boolean
  // stage_instances: any[]
  emojis: CustomEmoji[]
  // home_header?: any
  // default_message_notifications: number
  // afk_channel_id?: string
  roles: GuildRole[]
  // rules_channel_id?: string
  // vanity_url_code?: string
  // mfa_level: number
  // system_channel_id?: string
  // premium_progress_bar_enabled: boolean
  // splash?: any
  // region: string
  stickers: any[]
  channels: GuildChannel[]
  // incidents_data?: any
  // hub_type?: any
  // afk_timeout: number
  name: string
  owner_id: string
  // application_id?: string
  // latest_onboarding_question_id?: string
  // preferred_locale: string
  // max_stage_video_channel_users: number
}
