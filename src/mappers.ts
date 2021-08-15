import { CurrentUser, Message, MessageActionType, MessageAttachment, MessageAttachmentType, MessageLink, MessageReaction, TextEntity, Thread, ThreadType, User } from '@textshq/platform-sdk'
import { IGNORED_MESSAGE_TYPES, MessageActivityType, MessageEmbedType, MessageType, StickerFormat, THREAD_TYPES } from './constants'
import { mapTextAttributes } from './text-attributes'
import type { DiscordMessage, DiscordMessageEmbed, DiscordThread, DiscordUser } from './types'
import { getTimestampFromSnowflake, mapMimeType } from './util'

const getUserAvatar = (userID: string, avatarID: string) =>
  `https://cdn.discordapp.com/avatars/${userID}/${avatarID}.${avatarID.startsWith('a_') ? 'gif' : 'png'}?size=256`

const getThreadIcon = (threadID: string, iconID: string) =>
  `https://cdn.discordapp.com/channel-icons/${threadID}/${iconID}.png`

const getGuildIcon = (guildID: string, iconID: string) =>
  `https://cdn.discordapp.com/icons/${guildID}/${iconID}.png`

const getLottieStickerURL = (id: string, asset: string) =>
  (asset ? `https://discord.com/stickers/${id}/${asset}.json` : `https://discord.com/stickers/${id}.json`)

// adding &passthrough=false makes it a regular png instead of apng
const getPNGStickerURL = (id: string) =>
  `https://media.discordapp.net/stickers/${id}.png?size=512`

export const getEmojiURL = (emojiID: string, animated: boolean) =>
  `https://cdn.discordapp.com/emojis/${emojiID}.${animated ? 'gif' : 'png'}`

export const mapReaction = (reaction: any, participantID: string): MessageReaction => ({
  id: `${participantID}${reaction.emoji.id || reaction.emoji.name}`,
  reactionKey: reaction.emoji.id ? getEmojiURL(reaction.emoji.id, reaction.emoji.animated) : reaction.emoji.name,
  participantID,
  emoji: true,
})

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
  const type: ThreadType = THREAD_TYPES[thread.type]

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
    message.content = message.content?.replace(embed.url, '')

    switch (embed.type) {
      case MessageEmbedType.ARTICLE: {
        // haven't seen one in the wild
        break
      }
      case MessageEmbedType.GIFV: return {
        id: embed.url,
        type: MessageAttachmentType.VIDEO,
        mimeType: mapMimeType(embed.video.url),
        isGif: true,
        srcURL: embed.video.url,
        size: { width: embed.video.width, height: embed.video.height },
      }
      case MessageEmbedType.IMAGE: {
        const isGif = embed.thumbnail.url.toLowerCase().endsWith('.gif')
        return {
          id: embed.url,
          type: isGif ? MessageAttachmentType.VIDEO : MessageAttachmentType.IMG,
          mimeType: mapMimeType(embed.thumbnail.url),
          isGif,
          srcURL: embed.thumbnail.url,
          size: { width: embed.thumbnail.width, height: embed.thumbnail.height },
        }
      }
      case MessageEmbedType.LINK: {
        // already works ¯\_(ツ)_/¯
        break
      }
      case MessageEmbedType.RICH: {
        // handled somewhere else
        break
      }
      case MessageEmbedType.VIDEO: {
        // haven't seen one in the wild
        break
      }
    }
  }
  return [
    ...(message.attachments?.map(mapAttachment) || []),
    ...(message.stickers?.map(mapSticker) || []),
    ...(message.sticker_items?.map(mapSticker) || []),
    ...(message.embeds?.map(mapEmbed) || []),
  ].filter(Boolean)
}

export function mapMessage(message: DiscordMessage, currentUserID: string, reactionsDetails?: any[]): Message | undefined {
  if (IGNORED_MESSAGE_TYPES.has(message.type)) return
  else if (message.type === MessageType.THREAD_STARTER_MESSAGE) message = message.referenced_message

  const attachments = mapAttachments(message)
  const links: MessageLink[] = message.embeds
    ?.filter(e => e.type === MessageEmbedType.ARTICLE || e.type === MessageEmbedType.LINK || e.type === MessageEmbedType.VIDEO || e.type === MessageEmbedType.RICH)
    .filter(e => e.url)
    .map(e => {
      return {
        url: e.url,
        img: e.thumbnail?.url || e.image?.url,
        imgSize: { width: e.thumbnail?.width || e.image?.width, height: e.thumbnail?.height || e.image?.height },
        title: e.title || e.author?.name || e.url!,
        summary: e.description || undefined,
      }
    })

  if (message.activity?.type === MessageActivityType.SPOTIFY) {
    const spotifyLink: MessageLink = {
      url: message.activity.party_id,
      title: `Spotify - Listen together with ${message.author.username}`,
    }
    links.push(spotifyLink)
  }

  const reactions = reactionsDetails?.flatMap<MessageReaction>(r => (r.users as any[]).map(u => mapReaction(r, u.id)))

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
    threadID: message.channel_id,
  }

  // reactions property should only be present if they exist, or state sync message update event will remove the reactions
  if (reactions) mapped.reactions = reactions
  if (attachments && attachments.length > 0) mapped.attachments = attachments
  if (links && links.length > 0) mapped.links = links
  if (message.embeds?.find(e => e.type === MessageEmbedType.RICH)) Object.assign(mapped, mapRichEmbeds(message))

  Object.assign(mapped, mapMessageType(message))

  if (mapped.text && mapped.text.length > 0) {
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
  const ext = {
    [StickerFormat.PNG]: 'png',
    [StickerFormat.APNG]: 'png',
    [StickerFormat.LOTTIE]: 'json',
  }[sticker.format_type]
  return {
    id: sticker.id,
    type: MessageAttachmentType.IMG,
    mimeType: ext === 'json' ? 'image/lottie' : `image/${ext}`,
    isSticker: true,
    srcURL: ext === 'json' ? getLottieStickerURL(sticker.id, sticker.asset) : getPNGStickerURL(sticker.id),
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
      break
    }
  }
}

function mapRichEmbeds(message: DiscordMessage): Partial<Message> {
  type EmbedObject = { entity: TextEntity, text: string }

  // TODO: Test more rich embeds
  // TODO: Add support for `timestamp`, `color`, `footer`, `author` and `provider`

  // there can be only one rich embed in a message
  const embed = message.embeds?.find(e => e.type === MessageEmbedType.RICH)
  if (!embed) return

  const spacing = '\n\n'
  let offset = 0

  const description: EmbedObject | undefined = embed.description ? {
    entity: {
      from: 0,
      to: embed.description.length,
      bold: true,
    },
    text: embed.description,
  } : undefined
  if (description) offset += description.entity.to + spacing.length

  const fields: EmbedObject[] | undefined = embed.fields?.map(f => {
    const text = f.name + '\n' + f.value
    const entity = {
      from: offset,
      to: offset + f.name.length,
      bold: true,
    }
    offset += text.length + spacing.length

    return { text, entity }
  })

  let textFooter: string | undefined
  if (embed.footer?.text) textFooter = embed.footer.text
  if (embed.author?.name) textFooter = textFooter ? `${textFooter} • ${embed.author.name}` : embed.author.name

  const text = [description?.text].concat(fields?.map(f => f.text)).filter(Boolean).join(spacing)
  const entities = [description?.entity].concat(fields?.map(f => f.entity)).filter(Boolean)

  const final: Partial<Message> = {
    text,
    textAttributes: { entities },
    textHeading: embed.title,
    textFooter,
    links: embed.url ? [embed.url] : undefined,
  }

  const media = embed.image ?? embed.video ?? embed.thumbnail
  if (media) {
    final.attachments = [{
      id: media.url,
      type: (embed.image || embed.thumbnail) ? MessageAttachmentType.IMG : (embed.video ? MessageAttachmentType.VIDEO : MessageAttachmentType.UNKNOWN),
      mimeType: mapMimeType(media.url),
      srcURL: media.url,
      size: { width: media.width, height: media.height },
    }]
  }

  return final
}
