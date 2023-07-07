import { MessageReaction as TextsMessageReaction } from '@textshq/platform-sdk'
import { MessageReaction as DiscordMessageReaction } from '@/types/Discord'
import { URLs } from '@/util'

export function mapReaction(reaction: DiscordMessageReaction): TextsMessageReaction {
  const reactionKey = reaction.emoji.id ?? reaction.emoji.name
  const imgURL = reaction.emoji.id ? URLs.getEmojiURL(reaction.emoji.id, reaction.emoji.animated) : undefined
  return {
    id: `${reaction.user_id}${reactionKey}`,
    reactionKey,
    imgURL,
    participantID: reaction.user_id,
    emoji: !reaction.emoji.id,
  }
}
