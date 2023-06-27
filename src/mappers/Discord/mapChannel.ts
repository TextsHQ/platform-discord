import { ThreadType as TextsThreadType } from '@textshq/platform-sdk'
import {
  Thread as TextsThread,
} from '@/types/Texts'
import {
  UserChannel as DiscordChannel,
  UserChannelType as DiscordUserChannelType,
  Guild as DiscordGuild,
  GuildChannel as DiscordGuildChannel,
  GuildChannelType as DiscordGuildChannelType,
} from '@/types/Discord'
import { dateFromSnowflake, getChannelIconURL } from '@/util/Discord'
import { mapUser } from '@/mappers/Discord'

const ChannelTypeMap: { [key: string]: TextsThreadType } = {
  [DiscordUserChannelType.DM]: 'single',
  [DiscordUserChannelType.DMGroup]: 'group',
  // [DiscordUserChannelType.]: 'channel',
  // [DiscordUserChannelType.]: 'broadcast',
}

export function mapChannel(channel: DiscordChannel): TextsThread {
  const type = ChannelTypeMap[channel.type]
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
    imgURL: channel.icon ? getChannelIconURL(channel.id, channel.icon) : undefined,
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

const GuildChannelTypeMap: { [key: string]: TextsThreadType | undefined } = {
  [DiscordGuildChannelType.Default]: 'channel',
  // [DiscordGuildChannelType.]: 'group',
  // [DiscordGuildChannelType.]: 'channel',
  [DiscordGuildChannelType.Category]: undefined,
}

export function mapGuildChannel(channel: DiscordGuildChannel, guild?: DiscordGuild): TextsThread | undefined {
  // TODO: Participants

  const _channel: DiscordGuildChannel = {
    ...channel,
    guild_id: channel.guild_id ?? guild?.id,
  }

  const type = GuildChannelTypeMap[_channel.type]
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

export function mapGuildChannels(guild: DiscordGuild): TextsThread[] {
  // console.log(guild)
  const channels = guild.channels
    .map(channel => mapGuildChannel(channel, guild))
    .filter(c => c?.id) as TextsThread[]
  return channels
}
