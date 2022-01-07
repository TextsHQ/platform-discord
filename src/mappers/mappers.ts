import { CurrentUser, Message, MessageActionType, MessageAttachment, MessageAttachmentType, MessageLink, MessageReaction, Thread, ThreadType, User, PartialWithID, UserPresence, texts } from '@textshq/platform-sdk'
import { APIUser, APIChannel, EmbedType, MessageActivityType, APIAttachment, MessageType, GatewayPresenceUpdateData } from 'discord-api-types/v9'
import { uniqBy } from 'lodash'
import type { DiscordMessage, DiscordReactionDetails } from '../types'
import { IGNORED_MESSAGE_TYPES, StickerFormat, THREAD_TYPES } from '../constants'
import { getEmojiURL, getLottieStickerURL, getPNGStickerURL, getThreadIcon, getTimestampFromSnowflake, getUserAvatar } from '../util'
import { mapTextAttributes } from '../text-attributes'
import { handleArticleEmbed, handleGifvEmbed, handleImageEmbed, handleLinkEmbed, handleRichEmbed, handleVideoEmbed } from './rich-embeds'

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
  const activity = presence.activities?.length > 0 ? presence.activities?.[0] as any : undefined
  return {
    userID,
    status: presence.status as UserPresence['status'],
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
    timestamp: getTimestampFromSnowflake(channel.last_message_id ?? undefined),
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
  const type: ThreadType = THREAD_TYPES[thread.type]!

  const participants: User[] = thread.recipients?.map(mapUser) ?? []
  participants.sort((a, b) => ((a.username ?? '') < (b.username ?? '') ? 1 : -1))
  if (currentUser) participants.push(currentUser)

  const timestamp = getTimestampFromSnowflake(thread.last_message_id ?? undefined)
  const lastMessageTimestamp = getTimestampFromSnowflake(lastReadMessageID)

  return {
    _original: JSON.stringify(thread),
    id: thread.id,
    title: thread.name,
    isUnread: (timestamp ?? 0) > (lastMessageTimestamp ?? 0),
    lastReadMessageID,
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
    extra: {
      lastMessageID: thread.last_message_id,
    },
  }
}

export function mapMessage(message: DiscordMessage, currentUserID?: string, reactionsDetails?: (DiscordReactionDetails | undefined)[]): Message | PartialWithID<Message> | undefined {
  if (IGNORED_MESSAGE_TYPES.has(message.type)) return
  else if (message.type === MessageType.ThreadStarterMessage && message.referenced_message) message = message.referenced_message

  const reactions: MessageReaction[] | undefined = reactionsDetails?.flatMap<MessageReaction | undefined>(r => r?.users.map(u => mapReaction(r, u.id))).filter(Boolean) as (MessageReaction[] | undefined)

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
    const mappedTextAttributes = mapTextAttributes(mapped.text, getUserName)
    if (mappedTextAttributes?.text && mappedTextAttributes?.textAttributes) {
      mapped.text = mappedTextAttributes.text
      mapped.textAttributes = mappedTextAttributes.textAttributes
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

  message.embeds?.forEach(embed => {
    switch (embed.type) {
      case EmbedType.Article: {
        handleArticleEmbed(embed)
        break
      }
      case EmbedType.GIFV: {
        const attachment = handleGifvEmbed(embed)
        final.attachments!.push(attachment)
        break
      }
      case EmbedType.Image: {
        const attachment = handleImageEmbed(embed)
        final.attachments!.push(attachment)
        break
      }
      case EmbedType.Link: {
        const link = handleLinkEmbed(embed)
        final.links!.push(link)
        break
      }
      case EmbedType.Rich: {
        const handled = handleRichEmbed(embed, message)
        if (handled?.text) final.text = handled.text
        if (handled?.tweet) final.tweets!.push(handled.tweet)
        if (handled?.link) final.links!.push(handled.link)
        if (handled?.attachment) final.attachments!.push(handled.attachment)
        break
      }
      case EmbedType.Video: {
        const { link, attachment } = handleVideoEmbed(embed)
        if (link) final.links!.push(link)
        if (attachment) final.attachments!.push(attachment)
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
        url: message.activity.party_id!,
        title: `Listen together with ${message.author.username}`,
      }
      final.links!.push(link)
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

  final.attachments = [...final.attachments!, ...attachments, ...stickers].filter(Boolean)
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

function mapMessageType(message: DiscordMessage): Partial<Message> | undefined {
  switch (message.type) {
    case MessageType.RecipientAdd: {
      return {
        isAction: true,
        parseTemplate: true,
        text: `${message.mentions.map(m => `{{${m.id}}}`).join(', ')} joined`,
        action: {
          type: MessageActionType.THREAD_PARTICIPANTS_REMOVED,
          participantIDs: message.mentions.map(m => m.id),
          actorParticipantID: message.author.id,
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
          actorParticipantID: message.author.id,
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
          actorParticipantID: message.author.id,
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
          actorParticipantID: message.author.id,
        },
      }
    }

    case MessageType.ChannelPinnedMessage: {
      return {
        isAction: true,
        parseTemplate: true,
        linkedMessageID: message.message_reference?.message_id,
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
          actorParticipantID: message.author.id,
        },
      }
    }

    default: {
      return undefined
    }
  }
}
