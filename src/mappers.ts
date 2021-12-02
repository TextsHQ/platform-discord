import { CurrentUser, Message, MessageActionType, MessageAttachment, MessageAttachmentType, MessageLink, MessageReaction, Thread, ThreadType, User, PartialWithID, UserPresence, Tweet, texts } from '@textshq/platform-sdk'
import { APIUser, APIChannel, APIEmbed, EmbedType, MessageActivityType, APIAttachment, MessageType, GatewayPresenceUpdateData, PresenceUpdateStatus } from 'discord-api-types/v9'
import { uniqBy } from 'lodash'
import type { DiscordMessage, DiscordReactionDetails } from './types'
import { IGNORED_MESSAGE_TYPES, StickerFormat, THREAD_TYPES } from './constants'
import { mapTextAttributes } from './text-attributes'
import { getTimestampFromSnowflake, mapMimeType } from './util'

const getUserAvatar = (userID: string, avatarID: string) =>
  `https://cdn.discordapp.com/avatars/${userID}/${avatarID}.${avatarID.startsWith('a_') ? 'gif' : 'png'}?size=256`

const getThreadIcon = (threadID: string, iconID: string) =>
  `https://cdn.discordapp.com/channel-icons/${threadID}/${iconID}.png`

/* const getGuildIcon = (guildID: string, iconID: string) =>
  `https://cdn.discordapp.com/icons/${guildID}/${iconID}.png` */

const getLottieStickerURL = (id: string) =>
  `https://discord.com/stickers/${id}.json`

// adding &passthrough=false makes it a regular png instead of apng
const getPNGStickerURL = (id: string) =>
  `https://media.discordapp.net/stickers/${id}.png?size=512`

export const getEmojiURL = (emojiID: string, animated: boolean) =>
  `https://cdn.discordapp.com/emojis/${emojiID}.${animated ? 'gif' : 'png'}`

export const parseTweetURL = (url: string): { username: string, tweetID: string } | undefined => {
  const [, username, tweetID] = /https?:\/\/twitter\.com\/(.+?)\/status\/(\d+)/.exec(url) || []
  if (tweetID) return { username, tweetID }
}

export const mapReaction = (reaction: DiscordReactionDetails, participantID: string): MessageReaction => {
  // reaction.emoji = { id: '352592187265122304', name: 'pat' }
  // reaction.emoji = { id: null, name: '👍' }
  const reactionKey = (reaction.emoji.name || reaction.emoji.id)!
  return {
    id: `${participantID}${reactionKey}`,
    reactionKey,
    imgURL: reaction.emoji.id ? getEmojiURL(reaction.emoji.id, reaction.emoji.animated ?? false) : undefined,
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
    displayText: mapped.username!,
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
    description: channel.topic ?? undefined,
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

  const participants: User[] = thread.recipients?.map(mapUser) ?? []
  participants.sort((a, b) => ((a.username ?? '') < (b.username ?? '') ? 1 : -1))
  if (currentUser) participants.push(currentUser)

  const timestamp = getTimestampFromSnowflake(thread.last_message_id)
  const lastMessageTimestamp = getTimestampFromSnowflake(lastReadMessageID)

  return {
    _original: JSON.stringify(thread),
    id: thread.id,
    title: thread.name,
    isUnread: timestamp > lastMessageTimestamp,
    isReadOnly: thread.recipients?.[0]?.system ?? false,
    type,
    imgURL: thread.icon ? getThreadIcon(thread.id, thread.icon) : undefined,
    description: thread.topic ?? undefined,
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

export function mapMessage(message: DiscordMessage, currentUserID: string, reactionsDetails?: DiscordReactionDetails[]): Message | PartialWithID<Message> | undefined {
  if (IGNORED_MESSAGE_TYPES.has(message.type)) return
  // eslint-disable-next-line no-param-reassign
  else if (message.type === MessageType.ThreadStarterMessage && message.referenced_message) message = message.referenced_message

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

  Object.assign(mapped, mapAttachments(message))
  Object.assign(mapped, mapMessageType(message))

  if (mapped.text && mapped.text.length > 0) {
    const getUserName = (id: string): string => message.mentions.find(m => m.id === id)?.username || id
    const { text, textAttributes } = mapTextAttributes(mapped.text, getUserName)
    if (text && textAttributes) {
      mapped.text = text
      mapped.textAttributes = textAttributes
    }
  }

  return mapped
}

function mapAttachments(message: DiscordMessage): Partial<Message> {
  const final: Partial<Message> = {
    tweets: [],
    links: [],
    attachments: [],
  }

  // TODO: Article embed (shows up as unknown)
  const handleArticleEmbed = (embed: APIEmbed) => {
    texts.log(embed)
  }

  const handleGifvEmbed = (embed: APIEmbed) => {
    const attachment: MessageAttachment = {
      id: embed.url,
      type: MessageAttachmentType.IMG,
      mimeType: mapMimeType(embed.video.url),
      isGif: true,
      srcURL: embed.video.url,
      size: { width: embed.video.width, height: embed.video.height },
    }
    final.attachments.push(attachment)
  }

  const handleImageEmbed = (embed: APIEmbed) => {
    const image = embed.image ?? embed.thumbnail
    const attachment: MessageAttachment = {
      id: embed.url,
      type: MessageAttachmentType.IMG,
      mimeType: mapMimeType(image.url),
      isGif: image.url.toLowerCase().endsWith('.gif'),
      srcURL: image.proxy_url ?? image.url,
      size: { width: image.width, height: image.height },
    }
    final.attachments.push(attachment)
  }

  const handleLinkEmbed = (embed: APIEmbed) => {
    const image = embed.image ?? embed.thumbnail
    const link: MessageLink = {
      url: embed.url,
      img: image?.url,
      imgSize: image?.width && image?.height ? { width: image.width, height: image.height } : undefined,
      title: embed.title || embed.author?.name,
      summary: embed.description || undefined,
    }
    final.links.push(link)
  }

  const urlRegex = /https?:\/\/(www\.)?([-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6})\b\/([-a-zA-Z0-9()!@:%_+.~#?&/=]*)/gi
  const handleRichEmbed = (embed: APIEmbed) => {
    const [,, domain, path] = urlRegex.exec(embed.url) ?? []
    switch (domain?.toLowerCase()) {
      case 'twitter.com': {
        const [user,, tweetID] = path.split('/')
        if (tweetID) {
          // Tweet URL
          /*
              Discord treats every tweet image as standalone rich embed.
              We're searching for all of them later, so discard every standalone rich embed with only image/video.
          */
          if ((embed.image || embed.video) && !(embed.title || embed.description || embed.footer || embed.color)) return

          const images = [embed.image, ...(message.embeds?.filter(e => e.url === embed.url && (e.image || e.video) && !e.timestamp).map(e => e.image))].filter(Boolean).map(image => ({
            id: image.url,
            srcURL: image.proxy_url ?? image.url,
            type: MessageAttachmentType.IMG,
            size: image?.width && image?.height ? { width: image.width, height: image.height } : undefined,
          }))
          const video = embed.video ? {
            id: embed.video.url,
            srcURL: embed.thumbnail.url,
            type: MessageAttachmentType.IMG,
            size: embed.thumbnail?.width && embed.thumbnail?.height ? { width: embed.thumbnail.width, height: embed.thumbnail.height } : undefined,
          } : undefined
          const tweet: Tweet = {
            id: tweetID,
            user: {
              imgURL: embed.author?.icon_url,
              name: user,
              username: embed.author?.name,
            },
            text: embed.description,
            timestamp: embed.timestamp ? new Date(embed.timestamp) : undefined,
            url: embed.url,
            attachments: [...images, video].filter(Boolean),
          }
          final.tweets.push(tweet)
        } else {
          // general Twitter URL
          const image = embed.image ?? embed.thumbnail
          const link: MessageLink = {
            url: embed.url,
            img: image?.proxy_url ?? image?.url,
            imgSize: image?.width && image?.height ? { width: image.width, height: image.height } : undefined,
            title: embed.title,
            summary: embed.description,
          }
          final.links.push(link)
        }
        break
      }
      default: {
        let text = message.content
        if (embed.title) text += `\n**${embed.title}**\n`
        if (embed.description) text += `\n${embed.description}`
        if (embed.fields?.length > 0) {
          const fields = embed.fields.map(f => `**${f.name}**\n${f.value}`)
          text += '\n\n' + fields.join('\n\n')
        }
        final.text = text.trim()

        if (embed.url) {
          const link: MessageLink = {
            url: embed.url,
            title: embed.title,
          }
          final.links.push(link)
        }

        const image = embed.image ?? embed.thumbnail
        if (image) {
          const attachment: MessageAttachment = {
            id: image.url,
            type: MessageAttachmentType.IMG,
            srcURL: image.url,
            size: image.width && image.height ? { width: image.width, height: image.height } : undefined,
          }
          final.attachments.push(attachment)
        }
        break
      }
    }
  }

  const handleVideoEmbed = (embed: APIEmbed) => {
    if (embed.provider?.name.toLowerCase() === 'youtube') {
      const link: MessageLink = {
        url: embed.url,
        img: embed.thumbnail?.url,
        imgSize: embed.thumbnail?.width && embed.thumbnail?.height ? { width: embed.thumbnail.width, height: embed.thumbnail.height } : undefined,
        title: embed.title,
        summary: embed.description,
      }
      final.links.push(link)
    } else {
      const attachment: MessageAttachment = {
        id: embed.url,
        type: MessageAttachmentType.VIDEO,
        mimeType: mapMimeType(embed.video.url),
        srcURL: embed.video.url,
        size: { width: embed.video.width, height: embed.video.height },
      }
      final.attachments.push(attachment)
    }
  }

  message.embeds?.forEach(embed => {
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
        title: `Listen together with ${message.author.username}`,
      }
      final.links.push(link)
      break
    }
    case MessageActivityType.Spectate: {
      texts.log(message.activity)
      break
    }
  }

  const stickers: MessageAttachment[] = [...(message.stickers || []), ...(message.sticker_items || [])]?.map(sticker => {
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
      srcURL: ext === 'json' ? getLottieStickerURL(sticker.id) : getPNGStickerURL(sticker.id),
      fileName: sticker.name,
      size: { width: 160, height: 160 },
    }
  })
  const attachments = (message.attachments as APIAttachment[] ?? []).map(a => {
    const attachment: MessageAttachment = {
      id: a.id,
      type: MessageAttachmentType.UNKNOWN,
      isGif: false,
      isVoiceNote: false,
      size: a.width && a.height ? { width: a.width, height: a.height } : undefined,
      srcURL: a.url,
      posterImg: a.proxy_url,
      fileName: a.filename || undefined,
      fileSize: a.size || undefined,
    }
    const extension = (a.filename || a.url).toLowerCase().split('.').pop()

    // TODO: Improve this
    switch (extension) {
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'webp':
        attachment.type = MessageAttachmentType.IMG
        break
      case 'gif':
      case 'gifv':
        attachment.type = MessageAttachmentType.IMG
        attachment.isGif = true
        break
      case 'mp4':
      case 'mov':
      case 'webm':
        attachment.type = MessageAttachmentType.VIDEO
        break
      case 'mp3':
      case 'flac':
      case 'wav':
      case 'ogg':
        attachment.type = MessageAttachmentType.AUDIO
        attachment.isVoiceNote = true
        break
    }

    return attachment
  })

  final.attachments = [...final.attachments, ...attachments, ...stickers].filter(Boolean)
  final.tweets = uniqBy(final.tweets, 'id')
  if (final.tweets?.length > 0) {
    // TODO: Check if this works every time (can there be a tweet & attachment/link?)
    final.attachments = undefined
    final.links = undefined
  }

  const attachmentURLs = final.attachments?.map(a => a.id)
  if (attachmentURLs?.length === 1 && attachmentURLs[0] === message.content) final.text = ''

  return final
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
