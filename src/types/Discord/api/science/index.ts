import { ScienceEventType } from '@/types/Discord/ScienceEventType'

export type Event = {
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

export type Request = {
  events: Event[]
  token: string
}
