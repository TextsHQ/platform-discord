import { CurrentUser, Message, MessageActionType, MessageAttachment, MessageAttachmentType, MessageLink, MessageReaction, TextAttributes, Thread, ThreadType, User } from '@textshq/platform-sdk'
import { MessageType } from './constants'

const USER_REGEX = /<@!(\d*)>/g
const EMOTE_REGEX = /<(a?):([A-Za-z0-9_]+):(\d+)>/g
const SUPPORTED_MESSAGE_TYPES = [0, 1, 2, 3, 4, 5, 6, 19]

const getUserAvatar = (userID: string, avatarID: string) =>
  `https://cdn.discordapp.com/avatars/${userID}/${avatarID}.${avatarID.startsWith('a_') ? 'gif' : 'png'}?size=256`

const getThreadIcon = (threadID: string, iconID: string) =>
  `https://cdn.discordapp.com/channel-icons/${threadID}/${iconID}.png`

const getEmojiURL = (emojiID: string, animated: boolean) =>
  `https://cdn.discordapp.com/emojis/${emojiID}.${animated ? 'gif' : 'png'}`

export function mapUser(user: any): User {
  return {
    id: user.id,
    fullName: user.username,
    username: `${user.username}#${user.discriminator}`,
    imgURL: user.avatar ? getUserAvatar(user.id, user.avatar) : undefined,
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

export function mapThread(thread: any, isUnread: boolean, currentUser?: User, lastMessage?: any, userMappings?: Map<string, string>): Thread {
  const type: ThreadType = MAP_THREAD_TYPE[thread.type]

  const participants: User[] = thread.recipients?.map(mapUser)
  participants.sort((a, b) => ((a.username ?? '') < (b.username ?? '') ? 1 : -1))
  if (currentUser) participants.push(currentUser)

  const messages = (lastMessage && currentUser.id) ? [mapMessage(lastMessage, currentUser.id, [], userMappings)] : []

  return {
    _original: JSON.stringify(thread),
    id: thread.id,
    title: thread.name,
    isUnread,
    isReadOnly: false,
    type,
    imgURL: thread.icon ? getThreadIcon(thread.id, thread.icon) : undefined,
    description: thread.topic,
    timestamp: lastMessage?.timestamp ? new Date(lastMessage.timestamp) : undefined,
    messages: {
      hasMore: true,
      items: messages,
    },
    participants: {
      hasMore: false,
      items: participants,
    },
  }
}

export function mapMessage(message: any, currentUserID: string, reactionsDetails?: any[], userMappings?: Map<string, string>): Message | null {
  if (!SUPPORTED_MESSAGE_TYPES.includes(message.type)) return null

  const attachments = message.attachments.map(mapAttachment)

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

  const reactions = reactionsDetails?.flatMap<MessageReaction>(r =>
    r.users.map(u => ({
      id: r.emoji.id || r.emoji.name,
      reactionKey: r.emoji.id ? getEmojiURL(r.emoji.id, r.emoji.animated) : r.emoji.name,
      participantID: u.id,
      emoji: true,
    }))) || []

  const mapped: Message = {
    _original: JSON.stringify(message),
    id: message.id,
    timestamp: new Date(message.timestamp),
    editedTimestamp: message.edited_timestamp ? new Date(message.edited_timestamp) : undefined,
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

  Object.assign(mapped, mapMessageType(message))

  if (mapped.text) {
    const { text: transformedMessageText, textAttributes } = transformEmojisAndTags(mapped.text, userMappings)
    if (transformedMessageText && textAttributes) {
      mapped.text = transformedMessageText
      mapped.textAttributes = textAttributes
    }
  }

  return mapped
}

function mapAttachment(a): MessageAttachment {
  // TODO: Improve it
  const lowercased = (a.name || a.url).toLowerCase()
  let type = MessageAttachmentType.UNKNOWN

  let isGif = false
  let isVoiceNote = false

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
}

function transformEmojisAndTags(message?: string, userMappings?: Map<string, string>): { text?: string, textAttributes?: TextAttributes } {
  if (!message) return

  let emojiOffsetRemoved = 0
  let userOffsetRemoved = 0
  const textAttributes = { entities: [] }

  const text = message
    // @ts-expect-error
    .replaceAll(EMOTE_REGEX, (matched, animated, emote_name, emote_id, offset) => {
      const entity = {
        from: offset - emojiOffsetRemoved,
        to: offset - emojiOffsetRemoved + (emote_name.length + 2),
        replaceWithMedia: {
          mediaType: 'img',
          srcURL: getEmojiURL(emote_id, animated),
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
      const username = userMappings.get(user_id)

      const entity = {
        from: offset - userOffsetRemoved,
        to: offset - userOffsetRemoved + (username ? [...username.slice(0, -5)].length + 1 : matched.length),
        mentionedUser: {
          id: user_id,
          username,
        },
      }

      userOffsetRemoved += username ? matched.length - ([...username.slice(0, -5)].length + 1) : 0
      textAttributes.entities.push(entity)
      return username ? `@${username.slice(0, -5)}` : matched
    })

  return { text, textAttributes }
}

function mapMessageType(message: any): Partial<Message> {
  switch (message.type) {
    case MessageType.RECIPIENT_ADD:
      return {
        isAction: true,
        parseTemplate: true,
        text: `${message.mentions.map(m => `${m.username}#${m.discriminator}`).join(', ')} joined`,
        action: {
          type: MessageActionType.THREAD_PARTICIPANTS_REMOVED,
          participantIDs: message.mentions.map(m => m.id),
          actorParticipantID: null,
        },
      }
    case MessageType.RECIPIENT_REMOVE:
      return {
        isAction: true,
        parseTemplate: true,
        text: `${message.mentions.map(m => `${m.username}#${m.discriminator}`).join(', ')} left`,
        action: {
          type: MessageActionType.THREAD_PARTICIPANTS_REMOVED,
          participantIDs: message.mentions.map(m => m.id),
          actorParticipantID: null,
        },
      }
    case MessageType.CALL: {
      let text = message.content
      if (message.call?.ended_timestamp) {
        const startDate = new Date(message.timestamp)
        const endDate = new Date(message.call?.ended_timestamp)
        const timeLasted = (endDate.getTime() - startDate.getTime()) / 1000

        if (timeLasted >= 60 * 60) {
          text = `{{${message.author.id}}} started a call, which lasted ${Math.floor((timeLasted / 60) / 60)} hour(s)`
        } else if (timeLasted >= 60) {
          text = `{{${message.author.id}}} started a call, which lasted ${Math.floor(timeLasted / 60)} minute(s)`
        } else {
          text = `{{${message.author.id}}} started a call, which lasted ${Math.floor(timeLasted)} second(s)`
        }
      } else {
        text = `{{${message.author.id}}} started a call`
      }
      return { isAction: true, parseTemplate: true, text }
    }
    case MessageType.CHANNEL_NAME_CHANGE:
      return {
        isAction: true,
        parseTemplate: true,
        text: `{{${message.author.id}}} updated group title to "${message.content}"`,
        action: {
          type: MessageActionType.THREAD_TITLE_UPDATED,
          title: message.content,
          actorParticipantID: null,
        },
      }
    case MessageType.CHANNEL_ICON_CHANGE:
      return {
        isAction: true,
        parseTemplate: true,
        text: `{{${message.author.id}}} updated group icon`,
        action: {
          type: MessageActionType.THREAD_IMG_CHANGED,
          actorParticipantID: null,
        },
      }
    case MessageType.CHANNEL_PINNED_MESSAGE:
      return {
        isAction: true,
        parseTemplate: true,
        linkedMessageID: message.message_reference.message_id,
        text: `{{${message.author.id}}} pinned a message`,
      }
    default:
      return { text: message.content }
      break
  }
}
