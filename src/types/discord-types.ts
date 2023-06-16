import type { APIMessage, APIPartialEmoji, APIUser } from 'discord-api-types/v9'
import type { ScienceEventType } from '../constants'

export type DiscordMessage = APIMessage & {
  call?: {
    participants: string[]
    ended_timestamp?: string
  }
}

export type DiscordEmoji = {
  displayName: string
  reactionKey: string
  url: string
}

export type DiscordReactionDetails = {
  emoji: APIPartialEmoji
  users: APIUser[]
}

export type DiscordScienceEvent = {
  type: ScienceEventType
  properties?: {
    accessibility_support_enabled?: boolean
    accessibility_features?: number
    client_track_timestamp?: number
    client_uuid?: string
    client_send_timestamp?: number
    [others: string]: any
  }
}
