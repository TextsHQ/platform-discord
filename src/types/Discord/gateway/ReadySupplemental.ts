import { UserPresence } from '@/types/Discord/UserPresence'

export type ReadySupplemental = {
  // disclose: string[]
  guilds: any[]
  // lazy_private_channels: any[]
  merged_members: any[]
  merged_presences: {
    friends: UserPresence[]
    guilds: any[]
  }
}
