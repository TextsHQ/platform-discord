import { CurrentUser, Message as TextsMessage, MessageAttachment as TextsMessageAttachment, MessageAttachmentType, MessageLink, MessageReaction, Thread, ThreadType, User } from '@textshq/platform-sdk'

const USER_REGEX = /<@!(\d*)>/g
const EMOTE_REGEX = /<(a?):([A-Za-z0-9_]+):(\d+)>/g

export function mapUser(user: any): User {
  return {
    id: user.id,
    fullName: user.username,
    username: `${user.username}#${user.discriminator}`,
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
  participants.sort((a, b) => (a.username ?? '') < (b.username ?? '') ? 1 : -1 )
  if (currentUser) participants.push(currentUser)

  return {
    _original: JSON.stringify(thread),
    id: thread.id,
    title: thread.name,
    isUnread: false,
    isReadOnly: false,
    type,
    timestamp: new Date(thread.timestamp || lastMessage?.timestamp || 0),
    imgURL: (type === 'group' && thread.icon) ? `https://cdn.discordapp.com/channel-icons/${thread.id}/${thread.icon}.png` : thread.icon,
    description: thread.topic,
    lastMessageSnippet: transformMessageContent(lastMessage?.content),
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

export function mapMessage(message: any, currentUserID: string): TextsMessage {
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
    .filter(e => e.type === 'article' || e.type === 'link' || e.type === 'video' || e.type === 'rich')
    .filter(e => e.url)
    .map(e => {
      return {
        url: e.url!,
        img: e.thumbnail?.url || e.image?.url,
        imgSize: { width: e.thumbnail?.width || e.image?.width, height: e.thumbnail?.height || e.image?.height },
        title: e.title || e.author?.name || e.url!,
        summary: e.description || undefined,
      }
    })

  // TODO: Improve this - as of right now, it only displays reactions that current user has added.
  const reactions: MessageReaction[] = (message.reactions || []).filter(r => r.me).map(r => {
    return {
      id: r.emoji.id || r.emoji.name,
      reactionKey: r.emoji.name,
      participantID: currentUserID,
      emoji: r.emoji != undefined
    }
  })

  return {
    _original: message,
    id: message.id,
    timestamp: new Date(Date.parse(message.timestamp)),
    editedTimestamp: message.edited_timestamp ? new Date(Date.parse(message.edited_timestamp)) : undefined,
    senderID: message.author.id,
    text: transformMessageContent(message.content) || message.content,
    attachments,
    links,
    reactions,
    isSender: currentUserID === message.author.id,
    linkedMessageID: message.referenced_message?.id,
    isDeleted: message.deleted,
    cursor: message.id,
    threadID: message.channel_id,
  }
}

export function transformMessageContent(message?: string): string | undefined {
  if (!message) return

  return message
    .replaceAll(EMOTE_REGEX, (_, animated, emote_name, emote_id) => {
      return `<img src="https://cdn.discordapp.com/emojis/${emote_id}.${animated ? "gif" : "png"}" alt="${emote_name}">`
    })
    .replaceAll(USER_REGEX, (_, user_id) => {
      return `<USER_TAG:${user_id}>`
    })
}
