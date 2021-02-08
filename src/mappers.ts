import { CurrentUser, Message as TextsMessage, MessageAttachment as TextsMessageAttachment, MessageAttachmentType, MessageLink, MessageReaction as TextsMessageReaction, Thread, ThreadType, User } from '@textshq/platform-sdk'
import { Message as DiscordMessage, MessageReaction as DiscordMessageReaction } from 'better-discord.js'

export function mapUser(user: any): User {
  return {
    id: user.id,
    fullName: `${user.username}#${user.discriminator}`,
    username: user.username,
    nickname: user.username,
    imgURL: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` : undefined,
    isVerified: false,
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

const MAP_THREAD_TYPE: ThreadType[] = [
  'group', // GUILD_TEXT
  'single', // DM
  'group', // GUILD_VOICE
  'group', // GROUP_DM
  'group', // GUILD_CATEGORY
  'single', // GUILD_NEWS
  'single', // GUILD_STORE
]

export function mapThread(thread: any, currentUser?: User, lastMessage?: any): Thread {
  const type: ThreadType = MAP_THREAD_TYPE[thread.type]

  const participants: User[] = thread.recipients.map(mapUser)
  if (currentUser && type !== 'single') participants.push(currentUser)
  participants.sort((a, b) => (a.username ?? '') < (b.username ?? '') ? 1 : -1 )

  const firstParticipant = participants[0]

  return {
    _original: JSON.stringify(thread),
    id: thread.id,
    title: thread.name,
    isUnread: false,
    isReadOnly: false,
    isArchived: undefined,
    isPinned: false,
    // mutedUntil?: Date | 'forever',
    type,
    timestamp: new Date(thread.timestamp || lastMessage?.timestamp || 0),
    imgURL: thread.icon,
    // createdAt?: Date,
    // description: undefined,
    lastMessageSnippet: lastMessage?.content,
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

export function mapMessage(message: DiscordMessage, currentUserID: string): TextsMessage {
  const attachments: TextsMessageAttachment[] = message.attachments.map(a => {
    // TODO: Improve it
    const lowercased = (a.name || a.url).toLowerCase()
    let type: MessageAttachmentType = MessageAttachmentType.UNKNOWN
    let isGif: boolean = false
    let isVoiceNote: boolean = false
    if (lowercased.endsWith('.png') || lowercased.endsWith('.jpg') || lowercased.endsWith('.jpeg')) {
      type = MessageAttachmentType.IMG
    } else if (lowercased.endsWith('.gif') || lowercased.endsWith('.gifv')) {
      type = MessageAttachmentType.IMG
      isGif = true
    } else if (lowercased.endsWith('.mp4') || lowercased.endsWith('.mov') || lowercased.endsWith('.webm')) {
      type = MessageAttachmentType.VIDEO
    } else if (lowercased.endsWith('.mp3') || lowercased.endsWith('.flac') || lowercased.endsWith('.wav') || lowercased.endsWith('.ogg')) {
      type = MessageAttachmentType.AUDIO
      isVoiceNote = true
    }

    return {
      id: a.id,
      type,
      isGif,
      // isSticker?: boolean,
      isVoiceNote,
      size: a.width && a.height ? { width: a.width, height: a.height } : undefined,
      srcURL: a.url,
      posterImg: a.proxyURL,
      fileName: a.name || undefined,
      fileSize: a.size || undefined,
    }
  })

  const links: MessageLink[] = message.embeds
    .filter(e => e.type === 'article' || e.type === 'link')
    .filter(e => e.url)
    .map(e => {
      return {
        url: e.url!,
        img: e.thumbnail?.url || undefined,
        imgSize: (e.thumbnail?.width && e.thumbnail.height) ? { width: e.thumbnail.width, height: e.thumbnail.height } : undefined,
        title: e.title || e.url!,
        summary: e.description || undefined,
      }
    })

  return {
    id: message.id,
    timestamp: message.createdAt,
    editedTimestamp: message.editedAt || undefined,
    senderID: message.author.id,
    text: message.content,
    attachments,
    links,
    reactions: [], // TODO MessageReaction[],
    isSender: currentUserID === message.author.id,
    silent: false, // TODO: boolean,
    linkedMessageID: message.reference?.messageID || undefined,
    isDeleted: message.deleted,
    // action?: MessageAction,
    // cursor?: string,
    // buttons?: MessageButton[],
    // extra?: any,
    threadID: message.channel.id,
  }
}
