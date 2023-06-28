import { Emoji } from './Emoji'

export enum MessageReactionType {
  DEFAULT = 0,
}

export type MessageReaction = {
  user_id: string
  type: MessageReactionType
  message_id: string
  message_author_id: string
  emoji: Emoji
  channel_id: string
  count?: number
  count_details?: any
  // me_burst?: boolean
  // burst?: boolean
  // burst_count?: number
}
