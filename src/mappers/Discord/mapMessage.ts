import { DEBUG, LOG_PREFIX } from '@'
import * as TextsTypes from '@/types/Texts'
import * as DiscordTypes from '@/types/Discord'
import { mapReaction } from './mapReaction'

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

export function mapMessage(message: DiscordMessage): TextsMessage {
  const mappedSpecialMessage = message.type !== DiscordMessageType.Default ? mapSpecialMessage(message) : undefined

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
    // links?: MessageLink[];
    // iframeURL?: string;
    // reactions?: MessageReaction[];
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

    ...mappedSpecialMessage,
  }
}
