export type MessageAck = {
  version: number
  message_id: string
  last_viewed: number
  flags?: number
  channel_id: string
}
