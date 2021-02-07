import { CurrentUser, Message, Thread, User } from '@textshq/platform-sdk'

export function mapUser(user: any): User {
  const imgURL: string | undefined = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` : undefined

  return {
    id: user.id,
    fullName: user.username,
    username: `${user.username}#${user.discriminator}`,
    phoneNumber: user.phone,
    email: user.email,
    nickname: user.username,
    imgURL,
    isVerified: user.verified,
    cannotMessage: false,
    isSelf: false,
  }
}

export function mapCurrentUser(user: any): CurrentUser {
  return {
    displayText: `${user.username}#${user.discriminator}`,
    ...mapUser(user),
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

export function mapMessage(message: any): Message {
  return {
    id: message.id,
    timestamp: new Date(message.timestamp),
    editedTimestamp: message.edited_timestamp ? new Date(message.edited_timestamp) : undefined,
    // forwardedCount?: number,
    senderID: message.author.id,
    text: message.content,
    // textAttributes?: TextAttributes,
    // textHeading?: string,
    // textFooter?: string,
    attachments: [], // TODO MessageAttachement[],
    // links?: MessageLink[],
    // iframeURL?: string,
    reactions: [], // TODO MessageReaction[],
    // isDelivered?: boolean,
    isSender: true, // TODO boolean,
    // isErrored?: boolean,
    /**
     * `silent` messages will not mark the thread as unread, move the thread to the top of the list, or show a notification
     */
    silent: false, // TODO: boolean,
    // linkedMessageID?: string,
    // linkedMessage?: MessagePreview,
    // action?: MessageAction,
    // cursor?: string,
    // buttons?: MessageButton[],
    // extra?: any,
    threadID: message.channel_id,
  }
}
