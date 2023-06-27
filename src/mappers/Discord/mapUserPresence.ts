import { UserPresence as TextsUserPresence } from '@/types/Texts'
import { UserPresence as DiscordUserPresence, UserPresenceStatus as DiscordUserPresenceStatus } from '@/types/Discord'

const StatusMap: { [key: string]: TextsUserPresence['status'] } = {
  [DiscordUserPresenceStatus.Online]: 'online',
  [DiscordUserPresenceStatus.Offline]: 'offline',
  [DiscordUserPresenceStatus.Invisible]: 'invisible',
  [DiscordUserPresenceStatus.Idle]: 'idle',
  [DiscordUserPresenceStatus.DND]: 'dnd',
}

export function mapUserPresence(presence: DiscordUserPresence): TextsUserPresence {
  const firstActivity = presence.activities[0]
  const status = StatusMap[presence.status]

  return {
    userID: presence.user_id,
    status,
    customStatus: firstActivity?.state,
    lastActive: firstActivity ? new Date(firstActivity.created_at) : undefined,
  }
}
