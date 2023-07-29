import * as TextsTypes from '@/types/Texts'
import * as DiscordTypes from '@/types/Discord'
import { URLs, dateFromSnowflake } from '@/util/Discord'
import { mapUser } from '@/mappers/Discord'

const ChannelTypeMap: { [key: string]: TextsTypes.ThreadType | undefined } = {
  [DiscordTypes.ChannelType.GUILD_TEXT]: 'channel',
  [DiscordTypes.ChannelType.DM]: 'single',
  [DiscordTypes.ChannelType.GROUP_DM]: 'group',
  [DiscordTypes.ChannelType.GUILD_CATEGORY]: undefined,
  [DiscordTypes.ChannelType.GUILD_ANNOUNCEMENT]: 'broadcast',
  [DiscordTypes.ChannelType.ANNOUNCEMENT_THREAD]: 'broadcast',
  [DiscordTypes.ChannelType.PUBLIC_THREAD]: 'channel',
  [DiscordTypes.ChannelType.PRIVATE_THREAD]: 'channel',
  [DiscordTypes.ChannelType.GUILD_STAGE_VOICE]: undefined,
  [DiscordTypes.ChannelType.GUILD_DIRECTORY]: undefined,
  [DiscordTypes.ChannelType.GUILD_FORUM]: undefined,
}

export function mapChannel(channel: DiscordTypes.Channel): TextsTypes._Thread | undefined {
  const type = ChannelTypeMap[channel.type]
  if (!type) return

  const participants = channel.recipients.map(mapUser)
  const createdAt = dateFromSnowflake(channel.id)

  return {
    _original: JSON.stringify(channel),
    id: channel.id,
    title: channel.name,
    isUnread: false,
    isReadOnly: false,
    type,
    timestamp: channel.last_message_id ? dateFromSnowflake(channel.last_message_id) : createdAt,
    imgURL: channel.icon ? URLs.getChannelIconURL(channel.id, channel.icon) : undefined,
    createdAt,
    partialLastMessage: {
      id: channel.last_message_id,
    },
    messages: {
      items: [], hasMore: !!channel.last_message_id,
    },
    participants: {
      items: participants, hasMore: false,
    },
  }
}

export function mapGuildChannel(channel: DiscordTypes.Channel, guild?: DiscordTypes.Guild): TextsTypes._Thread | undefined {
  // TODO: Participants

  const _channel: DiscordTypes.Channel = {
    ...channel,
    guild_id: channel.guild_id ?? guild?.id,
  }

  const type = ChannelTypeMap[_channel.type]
  if (!type) return

  const createdAt = dateFromSnowflake(_channel.id)
  const isReadOnly = false // TODO: Type, permissions

  return {
    _original: JSON.stringify(_channel),
    folderName: guild?.name,
    id: _channel.id,
    title: _channel.name,
    isUnread: false,
    isReadOnly,
    type,
    timestamp: _channel.last_message_id ? dateFromSnowflake(_channel.last_message_id) : createdAt,
    createdAt,
    partialLastMessage: _channel.last_message_id ? {
      id: _channel.last_message_id,
    } : undefined,
    messages: {
      items: [], hasMore: !!_channel.last_message_id,
    },
    participants: {
      items: [], hasMore: true,
    },
    extra: {
      guildID: _channel.guild_id ?? guild?.id,
    },
  }
}

export function mapGuildChannels(guild: DiscordTypes.Guild): TextsTypes._Thread[] {
  const channels = guild.channels
    .map(channel => mapGuildChannel(channel, guild))
    .filter(c => !!c?.id) as TextsTypes.Thread[]
  return channels
}
