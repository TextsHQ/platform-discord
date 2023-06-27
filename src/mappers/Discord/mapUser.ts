import { User as TextsUser } from '@/types/Texts'
import { User as DiscordUser } from '@/types/Discord'
import { getUserAvatarURL } from '@/util/Discord'

export function mapUser(user: DiscordUser): TextsUser {
  const username = user.discriminator.length === 4 ? `${user.username}#${user.discriminator}` : user.username
  return {
    id: user.id,
    fullName: user.global_name ?? user.username,
    username,
    imgURL: user.avatar ? getUserAvatarURL(user.id, user.avatar) : undefined,
  }
}
