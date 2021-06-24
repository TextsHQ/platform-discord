import { CurrentUser, Message, MessageActionType, MessageAttachment, MessageAttachmentType, MessageLink, MessageReaction, Thread, ThreadType, User } from '@textshq/platform-sdk'
import { MessageType } from './constants'
import { mapTextAttributes } from './text-attributes'
import type { DiscordMessage, DiscordMessageEmbed, DiscordThread, DiscordUser } from './types'
import { getTimestampFromSnowflake } from './util'

// https://discord.com/developers/docs/resources/channel#message-object-message-sticker-format-types
enum StickerFormat {
  PNG = 1,
  APNG = 2,
  LOTTIE = 3,
}

const MAP_THREAD_TYPE: ThreadType[] = [
  'channel', // GUILD_TEXT
  'single', // DM
  'channel', // GUILD_VOICE
  'group', // GROUP_DM
  'channel', // GUILD_CATEGORY
  'broadcast', // GUILD_NEWS
  'broadcast', // GUILD_STORE
]

const getUserAvatar = (userID: string, avatarID: string) =>
  `https://cdn.discordapp.com/avatars/${userID}/${avatarID}.${avatarID.startsWith('a_') ? 'gif' : 'png'}?size=256`

const getThreadIcon = (threadID: string, iconID: string) =>
  `https://cdn.discordapp.com/channel-icons/${threadID}/${iconID}.png`

const getGuildIcon = (guildID: string, iconID: string) =>
  `https://cdn.discordapp.com/icons/${guildID}/${iconID}.png`

const getEmojiURL = (emojiID: string, animated: boolean) =>
  `https://cdn.discordapp.com/emojis/${emojiID}.${animated ? 'gif' : 'png'}`

const getStickerURL = (id: string, asset: string, ext: string) =>
  (asset ? `https://discord.com/stickers/${id}/${asset}.${ext}` : `https://discord.com/stickers/${id}.${ext}`)

export function mapUser(user: DiscordUser): User {
  return {
    id: user.id,
    fullName: user.username,
    username: `${user.username}#${user.discriminator}`,
    imgURL: user.avatar ? getUserAvatar(user.id, user.avatar) : undefined,
  }
}

export function mapCurrentUser(user: DiscordUser): CurrentUser {
  const mapped = mapUser(user)
  return {
    displayText: mapped.username,
    ...mapped,
  }
}

export function mapChannel(channel: any, isMuted: Boolean, guildName?: string): Thread {
  return {
    _original: JSON.stringify(channel),
    folderName: guildName,
    id: channel.id,
    title: channel.name,
    isUnread: false, // check it somehow
    isReadOnly: false, // check permissions
    mutedUntil: isMuted ? 'forever' : undefined,
    type: 'channel', // 'channel' | 'broadcast'
    // createdAt: guildJoinDate,
    description: channel.topic,
    timestamp: getTimestampFromSnowflake(channel.last_message_id),
    messages: {
      items: [],
      hasMore: true,
    },
    participants: {
      items: [],
      hasMore: true,
    },
  }
}

export function mapThread(thread: DiscordThread, lastReadMessageID?: string, currentUser?: User, userMappings?: Map<string, string>): Thread {
  const type: ThreadType = MAP_THREAD_TYPE[thread.type]

  const participants: User[] = thread.recipients?.map(mapUser)
  participants.sort((a, b) => ((a.username ?? '') < (b.username ?? '') ? 1 : -1))
  if (currentUser) participants.push(currentUser)

  const timestamp = getTimestampFromSnowflake(thread.last_message_id)
  const lastMessageTimestamp = getTimestampFromSnowflake(lastReadMessageID)

  return {
    _original: JSON.stringify(thread),
    id: thread.id,
    title: thread.name,
    isUnread: timestamp > lastMessageTimestamp,
    isReadOnly: thread.recipients[0]?.system,
    type,
    imgURL: thread.icon ? getThreadIcon(thread.id, thread.icon) : undefined,
    description: thread.topic,
    timestamp,
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

function mapAttachments(message: DiscordMessage) {
  const mapEmbed = (embed: DiscordMessageEmbed): MessageAttachment => {
    // todo handle more types
    if (embed.type !== 'gifv') return
    message.content = message.content?.replace(embed.url, '')
    return {
      id: embed.id,
      type: MessageAttachmentType.VIDEO,
      mimeType: 'video/mp4',
      isGif: true,
      srcURL: embed.video.url,
      size: { width: embed.video.width, height: embed.video.height },
    }
  }
  return [
    ...(message.attachments?.map(mapAttachment) || []),
    ...(message.stickers?.map(mapSticker) || []),
    ...(message.embeds?.map(mapEmbed) || []),
  ].filter(Boolean)
}

export function mapMessage(message: DiscordMessage, currentUserID: string, reactionsDetails?: any[]): Message {
  const attachments = mapAttachments(message)

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
    })))

  const mapped: Message = {
    _original: JSON.stringify(message),
    id: message.id,
    timestamp: new Date(message.timestamp),
    editedTimestamp: message.edited_timestamp ? new Date(message.edited_timestamp) : undefined,
    senderID: message.author?.id,
    text: message.content,
    isSender: message.author ? currentUserID === message.author?.id : undefined,
    linkedMessageID: message.referenced_message?.id,
    isDeleted: message.deleted,
    cursor: message.id,
    threadID: message.channel_id,
  }
  // reactions property should only be present if they exist, or state sync message update event will remove the reactions
  if (reactions) mapped.reactions = reactions
  if (attachments && attachments.length > 0) mapped.attachments = attachments
  if (links && links.length > 0) mapped.links = links

  Object.assign(mapped, mapMessageType(message))

  if (mapped.text) {
    const getUserName = (id: string): string => message.mentions.find(m => m.id === id)?.username || id
    const { text: transformedMessageText, textAttributes } = mapTextAttributes(mapped.text, getUserName)
    if (transformedMessageText && textAttributes) {
      mapped.text = transformedMessageText
      mapped.textAttributes = textAttributes
    }
  }

  return mapped
}

function mapSticker(sticker: any): MessageAttachment {
  // non-lottie stickers are untested
  const ext = {
    [StickerFormat.PNG]: 'png',
    [StickerFormat.APNG]: 'apng',
    [StickerFormat.LOTTIE]: 'json',
  }[sticker.format_type]
  return {
    id: sticker.id,
    type: MessageAttachmentType.IMG,
    mimeType: ext === 'json' ? 'image/lottie' : `image/${ext}`,
    isSticker: true,
    srcURL: getStickerURL(sticker.id, sticker.asset, ext),
    fileName: sticker.name,
    size: { width: 160, height: 160 },
  }
}

function mapMessageType(message: DiscordMessage): Partial<Message> {
  switch (message.type) {
    case MessageType.RECIPIENT_ADD: {
      return {
        isAction: true,
        parseTemplate: true,
        text: `${message.mentions.map(m => `{{${m.id}}}`).join(', ')} joined`,
        action: {
          type: MessageActionType.THREAD_PARTICIPANTS_REMOVED,
          participantIDs: message.mentions.map(m => m.id),
          actorParticipantID: null,
        },
      }
    }

    case MessageType.RECIPIENT_REMOVE: {
      return {
        isAction: true,
        parseTemplate: true,
        text: `${message.mentions.map(m => `{{${m.id}}}`).join(', ')} left`,
        action: {
          type: MessageActionType.THREAD_PARTICIPANTS_REMOVED,
          participantIDs: message.mentions.map(m => m.id),
          actorParticipantID: null,
        },
      }
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

    case MessageType.CHANNEL_NAME_CHANGE: {
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
    }

    case MessageType.CHANNEL_ICON_CHANGE: {
      return {
        isAction: true,
        parseTemplate: true,
        text: `{{${message.author.id}}} updated group icon`,
        action: {
          type: MessageActionType.THREAD_IMG_CHANGED,
          actorParticipantID: null,
        },
      }
    }

    case MessageType.CHANNEL_PINNED_MESSAGE: {
      return {
        isAction: true,
        parseTemplate: true,
        linkedMessageID: message.message_reference.message_id,
        text: `{{${message.author.id}}} pinned a message`,
      }
    }

    case MessageType.GUILD_MEMBER_JOIN: {
      return {
        isAction: true,
        parseTemplate: true,
        text: `{{${message.author.id}}} joined`,
        action: {
          type: MessageActionType.THREAD_PARTICIPANTS_ADDED,
          participantIDs: [message.author.id],
          actorParticipantID: null,
        },
      }
    }

    default: {
      return { text: message.content }
    }
  }
}
