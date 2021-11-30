import { CurrentUser, Message, MessageActionType, MessageAttachment, MessageAttachmentType, MessageLink, MessageReaction, TextEntity, Thread, ThreadType, User, PartialWithID, UserPresence, Tweet, texts } from '@textshq/platform-sdk'
import { APIUser, APIChannel, APIMessage, APIEmbed, EmbedType, MessageActivityType, APIAttachment, MessageType, APISticker, GatewayPresenceUpdateData, PresenceUpdateStatus } from 'discord-api-types/v9'
import type { DiscordMessage, DiscordReactionDetails } from './types'
import { IGNORED_MESSAGE_TYPES, StickerFormat, SUPPORTED_EMBED_TYPES, THREAD_TYPES } from './constants'
import { mapTextAttributes } from './text-attributes'
import { getTimestampFromSnowflake, mapMimeType } from './util'

const getUserAvatar = (userID: string, avatarID: string) =>
  `https://cdn.discordapp.com/avatars/${userID}/${avatarID}.${avatarID.startsWith('a_') ? 'gif' : 'png'}?size=256`

const getThreadIcon = (threadID: string, iconID: string) =>
  `https://cdn.discordapp.com/channel-icons/${threadID}/${iconID}.png`

/* const getGuildIcon = (guildID: string, iconID: string) =>
  `https://cdn.discordapp.com/icons/${guildID}/${iconID}.png` */

const getLottieStickerURL = (id: string, asset: string) =>
  (asset ? `https://discord.com/stickers/${id}/${asset}.json` : `https://discord.com/stickers/${id}.json`)

// adding &passthrough=false makes it a regular png instead of apng
const getPNGStickerURL = (id: string) =>
  `https://media.discordapp.net/stickers/${id}.png?size=512`

export const getEmojiURL = (emojiID: string, animated: boolean) =>
  `https://cdn.discordapp.com/emojis/${emojiID}.${animated ? 'gif' : 'png'}`

export const mapReaction = (reaction: DiscordReactionDetails, participantID: string): MessageReaction => {
  // reaction.emoji = { id: '352592187265122304', name: 'pat' }
  // reaction.emoji = { id: null, name: '👍' }
  const reactionKey = reaction.emoji.name || reaction.emoji.id
  return {
    id: `${participantID}${reactionKey}`,
    reactionKey,
    imgURL: reaction.emoji.id ? getEmojiURL(reaction.emoji.id, reaction.emoji.animated) : undefined,
    participantID,
    emoji: true,
  }
}

export const mapPresence = (userID: string, presence: GatewayPresenceUpdateData): UserPresence => {
  const activity = presence.activities?.length > 0 ? presence.activities[0] as any : undefined
  return {
    userID,
    isActive: presence.status !== PresenceUpdateStatus.Invisible && presence.status !== PresenceUpdateStatus.Offline,
    status: activity ? 'custom' : (presence.status as UserPresence['status']),
    customStatus: activity?.state ?? activity?.name,
  }
}

export function mapUser(user: APIUser): User {
  return {
    id: user.id,
    fullName: user.username,
    username: `${user.username}#${user.discriminator}`,
    imgURL: user.avatar ? getUserAvatar(user.id, user.avatar) : undefined,
  }
}

export function mapCurrentUser(user: APIUser): CurrentUser {
  const mapped = mapUser(user)
  return {
    displayText: mapped.username,
    ...mapped,
  }
}

export function mapChannel(channel: APIChannel, isMuted: Boolean, guildName?: string): Thread {
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

export function mapThread(thread: APIChannel, lastReadMessageID?: string, currentUser?: User): Thread {
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

function mapAttachment(a: APIAttachment): MessageAttachment {
  // TODO: Improve it
  const lowercased = (a.filename || a.url).toLowerCase()
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
    posterImg: a.proxy_url,
    fileName: a.filename || undefined,
    fileSize: a.size || undefined,
  }
}

function mapAttachments(message: APIMessage) {
  const mapEmbed = (embed: APIEmbed): MessageAttachment => {
    // eslint-disable-next-line no-param-reassign
    message.content = message.content?.replace(embed.url, '')

    switch (embed.type) {
      case EmbedType.Article: {
        // haven't seen one in the wild
        break
      }
      case EmbedType.GIFV: return {
        id: embed.url,
        type: MessageAttachmentType.VIDEO,
        mimeType: mapMimeType(embed.video.url),
        isGif: true,
        srcURL: embed.video.url,
        size: { width: embed.video.width, height: embed.video.height },
      }
      case EmbedType.Image: {
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
      case EmbedType.Link: {
        // already works ¯\_(ツ)_/¯
        break
      }
      case EmbedType.Rich: {
        // handled somewhere else
        break
      }
      case EmbedType.Video: {
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

export function mapMessage(message: DiscordMessage, currentUserID: string, reactionsDetails?: DiscordReactionDetails[]): Message | PartialWithID<Message> | undefined {
  if (IGNORED_MESSAGE_TYPES.has(message.type)) return
  // eslint-disable-next-line no-param-reassign
  else if (message.type === MessageType.ThreadStarterMessage) message = message.referenced_message

  const attachments = mapAttachments(message)
  const embeds = mapMessageEmbeds(message)

  const reactions = reactionsDetails?.flatMap<MessageReaction>(r => r.users.map(u => mapReaction(r, u.id)))

  const mapped: PartialWithID<Message> = {
    _original: JSON.stringify(message),
    id: message.id,
    linkedMessageID: message.referenced_message?.id,
    threadID: message.channel_id,
    text: message.content,
  }

  // these properties should only be present if they exist, or they'll cause issues with message update state sync events
  if (message.author) {
    mapped.senderID = message.author.id
    mapped.isSender = currentUserID === message.author.id
  }
  if (message.timestamp) mapped.timestamp = new Date(message.timestamp)
  if (message.edited_timestamp) mapped.editedTimestamp = new Date(message.edited_timestamp)
  if (reactions) mapped.reactions = reactions
  if (attachments?.length > 0) mapped.attachments = attachments
  Object.assign(mapped, mapMessageEmbeds(message))
  Object.assign(mapped, mapMessageType(message as DiscordMessage))

  if (mapped.text?.length > 0) {
    const getUserName = (id: string): string => message.mentions.find(m => m.id === id)?.username || id
    const { text, textAttributes } = mapTextAttributes(mapped.text, getUserName)
    if (text && textAttributes) {
      mapped.text = text
      mapped.textAttributes = textAttributes
    }
  }

  return mapped
}

function mapSticker(sticker: APISticker): MessageAttachment {
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
    case MessageType.RecipientAdd: {
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

    case MessageType.RecipientRemove: {
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

    case MessageType.Call: {
      let text = message.content
      if (message.call?.ended_timestamp) {
        const startDate = new Date(message.timestamp)
        const endDate = new Date(message.call?.ended_timestamp)
        const timeLasted = (endDate.getTime() - startDate.getTime()) / 1000

        if (timeLasted >= 60 * 60) {
          const hours = Math.floor((timeLasted / 60) / 60)
          text = `{{${message.author.id}}} started a call that lasted ${hours} hour${hours === 1 ? '' : 's'}`
        } else if (timeLasted >= 60) {
          const minutes = Math.floor(timeLasted / 60)
          text = `{{${message.author.id}}} started a call that lasted ${minutes} minute${minutes === 1 ? '' : 's'}`
        } else {
          const seconds = Math.floor(timeLasted)
          text = `{{${message.author.id}}} started a call that lasted ${seconds} second${seconds === 1 ? '' : 's'}`
        }
      } else {
        text = `{{${message.author.id}}} started a call`
      }
      return { isAction: true, parseTemplate: true, text }
    }

    case MessageType.ChannelNameChange: {
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

    case MessageType.ChannelIconChange: {
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

    case MessageType.ChannelPinnedMessage: {
      return {
        isAction: true,
        parseTemplate: true,
        linkedMessageID: message.message_reference.message_id,
        text: `{{${message.author.id}}} pinned a message`,
      }
    }

    case MessageType.GuildMemberJoin: {
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

/* function mapRichEmbeds(message: APIMessage): Partial<Message> {
  type EmbedObject = { entity: TextEntity, text: string }

  console.log(message.embeds)

  // TODO: Test more rich embeds
  // TODO: Add support for `timestamp`, `color`, `footer`, `author` and `provider`

  // there can be only one rich embed in a message
  const embed = message.embeds?.find(e => e.type === EmbedType.Rich)
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
  const link: MessageLink | undefined = embed.url ? {
    url: embed.url,
    title: embed.title, // TODO: Test
  } : undefined

  const final: Partial<Message> = {
    text,
    textAttributes: { entities },
    textHeading: embed.title,
    textFooter,
    links: link ? [link] : undefined,
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
} */

function mapMessageEmbeds(message: DiscordMessage): Partial<Message> {
  const final: Partial<Message> = {
    tweets: [],
    links: [],
  }

  // TODO: Article embed (shows up as unknown)
  const handleArticleEmbed = (embed: APIEmbed) => {
    texts.log(embed)
  }

  const handleGifvEmbed = (embed: APIEmbed) => {
    texts.log(embed)
  }

  const handleImageEmbed = (embed: APIEmbed) => {
    texts.log(embed)
  }

  const handleLinkEmbed = (embed: APIEmbed) => {
    const imgWidth = embed.thumbnail?.width ?? embed.image?.width
    const imgHeight = embed.thumbnail?.height ?? embed.image?.height
    const link: MessageLink = {
      url: embed.url,
      img: embed.thumbnail?.url || embed.image?.url,
      imgSize: imgWidth && imgHeight ? { width: imgWidth, height: imgHeight } : undefined,
      title: embed.title || embed.author?.name,
      summary: embed.description || undefined,
    }
    final.links.push(link)
  }

  const urlRegex = /https?:\/\/(www\.)?([-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6})\b\/([-a-zA-Z0-9()!@:%_+.~#?&/=]*)/gi
  const handleRichEmbed = (embed: APIEmbed) => {
    const [,, domain, path] = urlRegex.exec(embed.url)
    switch (domain.toLowerCase()) {
      case 'twitter.com': {
        const [user,, tweetID] = path.split('/')
        if (!tweetID) return
        const tweet: Tweet = {
          id: tweetID,
          user: {
            imgURL: embed.author?.icon_url,
            name: user,
            username: embed.author?.name,
          },
          text: embed.description,
          timestamp: new Date(embed.timestamp),
          url: embed.url,
        }
        final.tweets.push(tweet)
        break
      }
    }
  }

  const handleVideoEmbed = (embed: APIEmbed) => {
    texts.log(embed)
  }

  message.embeds.forEach(embed => {
    switch (embed.type) {
      case EmbedType.Article: {
        handleArticleEmbed(embed)
        break
      }
      case EmbedType.GIFV: {
        handleGifvEmbed(embed)
        break
      }
      case EmbedType.Image: {
        handleImageEmbed(embed)
        break
      }
      case EmbedType.Link: {
        handleLinkEmbed(embed)
        break
      }
      case EmbedType.Rich: {
        handleRichEmbed(embed)
        break
      }
      case EmbedType.Video: {
        handleVideoEmbed(embed)
        break
      }
    }
  })

  switch (message.activity?.type) {
    case MessageActivityType.Join: {
      texts.log(message.activity)
      break
    }
    case MessageActivityType.JoinRequest: {
      texts.log(message.activity)
      break
    }
    case MessageActivityType.Listen: {
      const link: MessageLink = {
        url: message.activity.party_id,
        title: `Spotify - Listen together with ${message.author.username}`,
      }
      final.links.push(link)
      break
    }
    case MessageActivityType.Spectate: {
      texts.log(message.activity)
      break
    }
  }

  return final
}
