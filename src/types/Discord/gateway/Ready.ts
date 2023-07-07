import { Guild, PrivateChannel, User, UserRelationship } from '@/types/Discord'
import { Partial } from '@/types/Discord/util'

enum SessionType {
  NORMAL = 'normal',
}

type ReadState = {
  // flags: number
  id: string
  last_message_id?: string
  last_pin_timestamp?: string
  // last_viewed: number
  mention_count: number
}

type GuildSetting = {
  suppress_roles: boolean
  suppress_everyone: boolean
  muted: boolean
  guild_id?: string
  channel_overrides: {
    muted: boolean
    mute_config?: {
      selected_time_window?: number
      end_time: string
    }
    channel_id: string
  }[]
}

export type Ready = {
  analytics_token: string
  auth_session_id_hash: string
  country_code: string
  // guild_join_requests: any[]
  guilds: Guild[]
  resume_gateway_url: string
  // relationships: any[]
  read_state: Partial<ReadState[]>
  relationships: UserRelationship[]
  private_channels: PrivateChannel[]
  merged_members: any[]
  session_id: string
  session_type: SessionType
  user: User
  user_guild_settings: Partial<GuildSetting[]>
  user_settings: {
    // inline_attachment_media: boolean
    status: 'online'
    // view_nsfw_guilds: boolean
    animate_emoji: boolean
    // guild_folders: any[]
    // activity_joining_restricted_guild_ids: any[]
    convert_emoticons: boolean
    custom_status?: any
    locale: string
  }
  // user_settings_proto: string
  users: User[]
}
