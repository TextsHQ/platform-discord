import { ChannelType } from '@/types/Discord'

export type PrivateChannel = {
  type: ChannelType
  recipient_ids: string[]
  owner_id?: string
  name?: string
  last_pin_timestamp?: string
  last_message_id?: string
  id: string
  icon?: string
  // flags: number
}
