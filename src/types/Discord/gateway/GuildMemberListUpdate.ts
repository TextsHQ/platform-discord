import { GuildMember } from '../GuildMember'

enum OP {
  Sync = 'SYNC',
}

export type GuildMemberListUpdate = {
  ops: {
    range: [number, number]
    op: OP
    items: {
      group?: {
        id: string
        count: number
      }
      member?: GuildMember
    }[]
  }[]
  online_count: number
  member_count: number
  id: string
  guild_id: string
  groups: {
    id: string
    count: number
  }[]
}
