import { CurrentUser, Thread, ThreadType, User } from '@textshq/platform-sdk'

export function mapUser(user: any): User {
  return {
    id: user.id,
    fullName: user.username,
    username: `${user.username}#${user.discriminator}`,
    phoneNumber: user.phone,
    email: user.email,
    nickname: user.username,
    imgURL: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`,
    isVerified: user.verified,
    cannotMessage: false,
    isSelf: false,
  }
}

export function mapCurrentUser(user: any): CurrentUser {
  return {
    displayText: `${user.username}#${user.discriminator}`,
    id: user.id,
    fullName: user.username,
    username: `${user.username}#${user.discriminator}`,
    phoneNumber: user.phone,
    email: user.email,
    nickname: user.username,
    imgURL: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`,
    isVerified: user.verified,
    cannotMessage: false,
    isSelf: true,
  }
}

const MAP_THREAD_TYPE = {
  GUILD_TEXT: 'group',
  DM: 'single',
  GUILD_VOICE: 'group',
  GROUP_DM: 'group',
  GUILD_CATEGORY: 'group',
  GUILD_NEWS: 'single',
  GUILD_STORE: 'single',
}

export function mapThread(thread: any, lastMessageSnippet: string): Thread {
  const participants: User[] = thread.recipients.map(mapUser)
  const firstParticipant: User = participants[0]
  const title: string = thread.name || firstParticipant.username || '<unnamed>'
  const id: string = participants.length > 1 ? thread.id : firstParticipant.id

  return {
    id,
    title,
    isUnread: true,
    isReadOnly: false,
    isArchived: undefined,
    isPinned: false,
    // mutedUntil?: Date | 'forever',
    type: MAP_THREAD_TYPE[thread.type],
    timestamp: new Date(),
    imgURL: thread.icon ? `https://cdn.discordapp.com/avatars/${thread.id}/${thread.icon}.png?size=256` : firstParticipant.imgURL,
    // createdAt?: Date,
    // description: undefined,
    lastMessageSnippet,
    messages: {
      hasMore: true,
      items: [],
    },
    participants: {
      hasMore: false,
      items: participants,
    },
  }
}

export function mapMessage(message: any) {

}
