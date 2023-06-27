import { Thread as TextsThread } from '@/types/Texts'
import { Channel as DiscordChannel } from '@/types/Discord'

export function mapPartialThread(thread: Partial<TextsThread>): Partial<DiscordChannel> {
  // Currently only setting title is supported.
  return {
    name: thread.title,
  }
}
