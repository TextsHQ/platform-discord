import { User, UserPresence } from '@/types/Discord'

export type GuildMember = {
  user: User
  roles: string[]
  presence: UserPresence
  premium_since: string | null
  pending: boolean
  nick?: string
  mute: boolean
  joined_at: string
  flags: number
  deaf: boolean
  communication_disabled_until?: string
  avatar?: string
}
