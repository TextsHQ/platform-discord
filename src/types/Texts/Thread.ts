import { Thread as TextsThread } from '@textshq/platform-sdk'

export type _Thread = TextsThread & {
  extra?: {
    guildID?: string
  }
}
