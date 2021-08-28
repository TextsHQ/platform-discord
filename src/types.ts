import type { APIMessage, APIPartialEmoji, APIUser } from 'discord-api-types/v9'

export type DiscordMessage = APIMessage & {
  call?: {
    participants: string[],
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
