import { User } from './User'

export interface UserChannel {
  id: string
  type: UserChannelType
  last_message_id?: string
  // flags: number
  last_pin_timestamp?: string
  recipients: User[]
  name?: string
  icon?: string
}

export enum UserChannelType {
  DM = 1,
  DMGroup = 3,
}
