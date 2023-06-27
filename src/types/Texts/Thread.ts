import { Thread as TextsThread } from '@textshq/platform-sdk'

export type Thread = TextsThread & {
  extra?: {
    guildID?: string
  }
}
