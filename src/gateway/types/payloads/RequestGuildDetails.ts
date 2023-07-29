export interface RequestGuildDetails {
  guild_id?: string
  typing?: boolean
  threads?: boolean
  activities?: boolean
  channels?: {
    [key: string]: [number, number][]
  }
  members?: any[]
  thread_member_lists?: any[]
}
