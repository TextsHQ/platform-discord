import { UserPresence as TextsUserPresence } from '@textshq/platform-sdk'
import { UserPresence as DiscordUserPresence, UserPresenceStatus as DiscordUserPresenceStatus } from '@/types/Discord'

const DiscordToTextsStatusMap: { [key: string]: TextsUserPresence['status'] } = {
  [DiscordUserPresenceStatus.Online]: 'online',
  [DiscordUserPresenceStatus.Offline]: 'offline',
  [DiscordUserPresenceStatus.Invisible]: 'invisible',
  [DiscordUserPresenceStatus.Idle]: 'idle',
  [DiscordUserPresenceStatus.DND]: 'dnd',
}

export function mapUserPresence(presence: DiscordUserPresence): TextsUserPresence {
  const firstActivity = presence.activities[0]
  const status = DiscordToTextsStatusMap[presence.status]

  return {
    userID: presence.user_id,
    status,
    customStatus: firstActivity?.state,
    lastActive: firstActivity ? new Date(firstActivity.created_at) : undefined,
  }
}
