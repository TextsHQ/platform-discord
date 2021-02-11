import { CurrentUser, Message as TextsMessage, MessageAttachment as TextsMessageAttachment, MessageAttachmentType, MessageLink, MessageReaction, TextAttributes, Thread, ThreadType, User } from '@textshq/platform-sdk'

const USER_REGEX = /<@!(\d*)>/g
const EMOTE_REGEX = /<(a?):([A-Za-z0-9_]+):(\d+)>/g

export function mapUser(user: any): User {
  let imgURL: string | undefined
  if (user.avatar) {
    imgURL = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256`
  }

  return {
    id: user.id,
    fullName: user.username,
    username: `${user.username}#${user.discriminator}`,
    nickname: user.username,
    imgURL,
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

export function mapThread(thread: any, currentUser?: User, lastMessage?: any, userMappings?: Set<{ id: string, username: string }>): Thread {
  const type: ThreadType = MAP_THREAD_TYPE[thread.type]

  const participants: User[] = thread.recipients.map(mapUser)
  participants.sort((a, b) => ((a.username ?? '') < (b.username ?? '') ? 1 : -1))
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
    lastMessageSnippet: lastMessage ? transformEmojisAndTags(lastMessage.content, userMappings).text : undefined,
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

export function mapMessage(message: any, currentUserID: string, reactionsDetails?: any, userMappings?: Set<{ id: string, username: string }>): TextsMessage {
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

  let reactions: MessageReaction[] = []
  if (reactionsDetails) {
    reactions = reactionsDetails.flatMap(r => {
      return r.users.map(u => (
        {
          id: r.emoji.id || r.emoji.name,
          reactionKey: r.emoji.id ? `https://cdn.discordapp.com/emojis/${r.emoji.id}.${r.emoji.animated ? 'gif' : 'png'}` : r.emoji.name,
          participantID: u.id,
          emoji: true,
        }
      ))
    })
  }

  const mapped: TextsMessage = {
    _original: message,
    id: message.id,
    timestamp: new Date(Date.parse(message.timestamp)),
    editedTimestamp: message.edited_timestamp ? new Date(Date.parse(message.edited_timestamp)) : undefined,
    senderID: message.author.id,
    text: message.content,
    attachments,
    links,
    reactions,
    isSender: currentUserID === message.author.id,
    linkedMessageID: message.referenced_message?.id,
    isDeleted: message.deleted,
    cursor: message.id,
    threadID: message.channel_id,
  }

  if (mapped.text) {
    const { text, textAttributes } = transformEmojisAndTags(mapped.text, userMappings)
    if (text && textAttributes) {
      mapped.text = text
      mapped.textAttributes = textAttributes
    }
  }

  return mapped
}

function transformEmojisAndTags(message?: string, userMappings?: Set<{ id: string, username: string }>): { text?: string, textAttributes?: TextAttributes } {
  if (!message) return

  let emojiOffsetRemoved = 0
  let userOffsetRemoved = 0
  const textAttributes = { entities: [] }

  const text = message
    .replaceAll(EMOTE_REGEX, (matched, animated, emote_name, emote_id, offset) => {
      const entity = {
        from: offset - emojiOffsetRemoved,
        to: offset - emojiOffsetRemoved + (emote_name.length + 2),
        replaceWithMedia: {
          mediaType: 'img',
          srcURL: `https://cdn.discordapp.com/emojis/${emote_id}.${animated ? 'gif' : 'png'}`,
          size: {
            width: message.length === matched.length ? 64 : 16,
            height: message.length === matched.length ? 64 : 16,
          },
        },
      }

      emojiOffsetRemoved += matched.length - (emote_name.length + 2)
      textAttributes.entities.push(entity)
      return `:${emote_name}:`
    })
    .replaceAll(USER_REGEX, (matched, user_id, offset) => {
      const user = Array.from(userMappings).find(u => u.id === user_id)

      const entity = {
        from: offset - userOffsetRemoved,
        to: offset - userOffsetRemoved + (user ? user.username.slice(0, -5).length + 1 : matched.length),
        mentionedUser: {
          id: user_id,
          username: user.username,
        },
      }

      userOffsetRemoved += user ? matched.length - `@${user.username.slice(0, -5)}`.length : 0
      textAttributes.entities.push(entity)
      return user ? `@${user.username.slice(0, -5)}` : matched
    })

  return { text, textAttributes }
}
