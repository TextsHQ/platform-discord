/* eslint-disable no-useless-return */
import { Message as TextsMessage } from '@textshq/platform-sdk'
import { Message as DiscordMessage, MessageType as DiscordMessageType } from '@/types/Discord'
import { LOG_PREFIX } from '@'

export function mapSpecialMessage(message: DiscordMessage): Partial<TextsMessage> | undefined {
  switch (message.type) {
    case DiscordMessageType.Default: {
      return
    }

    case DiscordMessageType.RecipientAdd: {
      const mentionsJoined = message.mentions?.map(m => `{{${m.id}}}`).join(', ')
      return {
        parseTemplate: true,
        isAction: true,
        text: `{{${message.author.id}}} added ${mentionsJoined}`,
      }
    }

    case DiscordMessageType.RecipientRemove: {
      const mentionsJoined = message.mentions?.map(m => `{{${m.id}}}`).join(', ')
      return {
        parseTemplate: true,
        isAction: true,
        text: `{{${message.author.id}}} removed ${mentionsJoined}`,
      }
    }

    case DiscordMessageType.Call: {
      return {
        parseTemplate: true,
        isAction: true,
        text: `{{${message.author.id}}} started a call`, // TODO: How long?
      }
    }

    case DiscordMessageType.ChannelNameChange: {
      return {
        parseTemplate: true,
        isAction: true,
        text: `{{${message.author.id}}} changed channel name to "${message.content}"`,
      }
    }

    case DiscordMessageType.ChannelIconChange: {
      return {
        parseTemplate: true,
        isAction: true,
        text: `{{${message.author.id}}} changed the channel icon`,
      }
    }

    case DiscordMessageType.ChannelPinnedMessage: {
      return {
        parseTemplate: true,
        isAction: true,
        // text: `{{${message.author.id}}} pinned {{${message.message_reference?.message_id}}}`,
        text: `{{${message.author.id}}} pinned a message`,
      }
    }

    case DiscordMessageType.GuildMemberJoin: {
      return {
        parseTemplate: true,
        isAction: true,
        text: `{{${message.author.id}}} joined`,
      }
    }

    case DiscordMessageType.UserPremiumGuildSubscription: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordMessageType.UserPremiumGuildSubscriptionTier1: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordMessageType.UserPremiumGuildSubscriptionTier2: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordMessageType.UserPremiumGuildSubscriptionTier3: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordMessageType.ChannelFollowAdd: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordMessageType.GuildDiscoveryDisqualified: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordMessageType.GuildDiscoveryRequalified: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordMessageType.GuildDiscoveryGracePeriodInitialWarning: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordMessageType.GuildDiscoveryGracePeriodFinalWarning: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordMessageType.Reply: {
      return
    }

    case DiscordMessageType.ChatInputCommand: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordMessageType.GuildInviteReminder: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    case DiscordMessageType.ContextMenuCommand: {
      // TODO
      return {
        parseTemplate: true,
        isAction: true,
      }
    }

    default: {
      console.warn(LOG_PREFIX, 'Unhandled MessageType', message)
      return
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
