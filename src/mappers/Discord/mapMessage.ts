import { DEBUG, LOG_PREFIX } from '@'
import * as TextsTypes from '@/types/Texts'
import * as DiscordTypes from '@/types/Discord'
import { mapReaction } from './mapReaction'
import { URLs } from '@/util'

const AttachmentTypeMap: { [key: string]: TextsTypes.AttachmentType | undefined } = {
  'image/png': TextsTypes.AttachmentType.IMG,
  'image/jpeg': TextsTypes.AttachmentType.IMG,
  'image/gif': TextsTypes.AttachmentType.IMG,
  'video/quicktime': TextsTypes.AttachmentType.VIDEO,
}

export function mapSpecialMessage(message: DiscordTypes.Message): Partial<TextsTypes.Message> | undefined {
  switch (message.type) {
    case DiscordTypes.MessageType.DEFAULT: {
      return
    }

    case DiscordTypes.MessageType.RECIPIENT_ADD: {
      const mentionsJoined = message.mentions?.map(m => `{{${m.id}}}`).join(', ')
      return {
        parseTemplate: true,
        isAction: true,
        text: `{{${message.author.id}}} added ${mentionsJoined}`,
      }
    }

    case DiscordTypes.MessageType.RECIPIENT_REMOVE: {
      const mentionsJoined = message.mentions?.map(m => `{{${m.id}}}`).join(', ')
      return {
        parseTemplate: true,
        isAction: true,
        text: `{{${message.author.id}}} removed ${mentionsJoined}`,
      }
    }

    case DiscordTypes.MessageType.CALL: {
      return {
        parseTemplate: true,
        isAction: true,
        text: `{{${message.author.id}}} started a call`, // TODO: How long?
      }
    }

    case DiscordTypes.MessageType.CHANNEL_NAME_CHANGE: {
      return {
        parseTemplate: true,
        isAction: true,
        text: `{{${message.author.id}}} changed channel name to "${message.content}"`,
      }
    }

    case DiscordTypes.MessageType.CHANNEL_ICON_CHANGE: {
      return {
        parseTemplate: true,
        isAction: true,
        text: `{{${message.author.id}}} changed the channel icon`,
      }
    }

    case DiscordTypes.MessageType.CHANNEL_PINNED_MESSAGE: {
      return {
        parseTemplate: true,
        isAction: true,
        // text: `{{${message.author.id}}} pinned {{${message.message_reference?.message_id}}}`,
        text: `{{${message.author.id}}} pinned a message`,
      }
    }

    case DiscordTypes.MessageType.USER_JOIN: {
      return {
        parseTemplate: true,
        isAction: true,
        text: `{{${message.author.id}}} joined`,
      }
    }

    case DiscordTypes.MessageType.GUILD_BOOST: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.GUILD_BOOST_TIER_1: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.GUILD_BOOST_TIER_2: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.GUILD_BOOST_TIER_3: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.CHANNEL_FOLLOW_ADD: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.GUILD_DISCOVERY_DISQUALIFIED: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.GUILD_DISCOVERY_REQUALIFIED: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.GUILD_DISCOVERY_GRACE_PERIOD_INITIAL_WARNING: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.GUILD_DISCOVERY_GRACE_PERIOD_FINAL_WARNING: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.REPLY: {
      return
    }

    case DiscordTypes.MessageType.CHAT_INPUT_COMMAND: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.GUILD_INVITE_REMINDER: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.CONTEXT_MENU_COMMAND: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.AUTO_MODERATION_ACTION: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.ROLE_SUBSCRIPTION_PURCHASE: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.INTERACTION_PREMIUM_UPSELL: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.STAGE_START: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.STAGE_END: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.STAGE_SPEAKER: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.STAGE_TOPIC: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordTypes.MessageType.GUILD_APPLICATION_PREMIUM_SUBSCRIPTION: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    default: {
      if (DEBUG) console.warn(LOG_PREFIX, 'Unhandled MessageType', message)
    }
  }
}

export function mapMessageEmbeds(message: DiscordTypes.Message): Partial<TextsTypes.Message> | undefined {
  // TODO: Map other things

  const stickers: TextsTypes.Message['attachments'] = message.sticker_items?.map(item => {
    const isGif = item.format_type === DiscordTypes.StickerType.APNG
      || item.format_type === DiscordTypes.StickerType.LOTTIE
      || item.format_type === DiscordTypes.StickerType.GIF

    return {
      id: item.id,
      type: TextsTypes.AttachmentType.IMG,
      isGif,
      isSticker: true,
      srcURL: URLs.getStickerURL(item.id),
    }
  })

  const attachments: TextsTypes.Message['attachments'] = message.attachments?.map(item => {
    const size = item.width && item.height ? { width: item.width, height: item.height } : undefined
    const type: TextsTypes.AttachmentType = AttachmentTypeMap[item.content_type] ?? TextsTypes.AttachmentType.UNKNOWN

    return {
      id: item.id,
      type,
      size,
      posterImg: item.proxy_url,
      mimeType: item.content_type,
      fileName: item.filename,
      fileSize: item.size,
      isGif: item.content_type === 'image/gif',
      // isVoiceNote?: boolean;
      srcURL: item.url,
    }
  })

  const links: TextsTypes.Message['links'] = message.embeds?.map(item => {
    const media = item.image ?? item.thumbnail
    const imgSize = media?.width && media?.height ? { width: media.width, height: media.height } : undefined

    return {
      url: item.url,
      img: media?.proxy_url ?? media?.url,
      imgSize,
      title: item.title,
      summary: item.description,
    }
  })

  return {
    attachments: [
      ...attachments ?? [],
      ...stickers ?? [],
    ],
    // tweets?: Tweet[];
    links,
    // buttons?: MessageButton[];
  }
}

export function mapMessage(message: DiscordTypes.Message): TextsTypes.Message {
  const mappedSpecialMessage = mapSpecialMessage(message)
  const mappedEmbeds = message.embeds ? mapMessageEmbeds(message) : undefined

  return {
    _original: JSON.stringify(message),
    id: message.id,
    timestamp: new Date(message.timestamp),
    editedTimestamp: message.edited_timestamp ? new Date(message.edited_timestamp) : undefined,
    senderID: message.author.id,
    text: message.content,
    // textAttributes?: TextAttributes;
    // textHeading?: string;
    // textFooter?: string;
    // attachments?: Attachment[];
    // tweets?: Tweet[];
    // iframeURL?: string;
    reactions: message.reactions ? message.reactions.map(mapReaction) : undefined,
    linkedMessageThreadID: message.message_reference?.channel_id ?? message.referenced_message?.channel_id,
    linkedMessageID: message.message_reference?.message_id ?? message.referenced_message?.id,
    linkedMessage: message.referenced_message ? {
      id: message.referenced_message.id ?? message.message_reference?.message_id,
      senderID: message.referenced_message.author.id,
      threadID: message.referenced_message.channel_id ?? message.message_reference?.channel_id,
      text: message.referenced_message.content,
    } : undefined,
    // action?: MessageAction;
    // cursor: message.id,
    // buttons?: MessageButton[];
    // behavior?: MessageBehavior;
    // accountID?: string;
    threadID: message.channel_id,
    // sortKey?: string | number;

    ...mappedEmbeds,
    ...mappedSpecialMessage,
  }
}
