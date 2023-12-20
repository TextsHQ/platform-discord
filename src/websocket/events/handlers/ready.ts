import type {
  APIChannel,
  APIGuild,
  APIUser,
  GatewayPresenceUpdateData,
  Snowflake,
} from 'discord-api-types/v9'
import { texts } from '@textshq/platform-sdk'

import type DiscordNetworkAPI from '../../../network-api'
import { ENABLE_DISCORD_ANALYTICS, ENABLE_GUILDS } from '../../../preferences'
import { getEmojiURL } from '../../../util'
import { DiscordEmoji } from '../../../types/discord-types'
import { IGNORED_CHANNEL_TYPES } from '../../../constants'
import { mapPresence, mapThread } from '../../../mappers/mappers'
import { GatewayMessageType } from '../../constants'

export default function attachReadyHandlers(api: DiscordNetworkAPI) {
  api.gatewayEvents.on(GatewayMessageType.READY, message => {
    // Assert the entire structure of the READY packet in one go. TODO: Move
    // this somewhere else.
    const d = message.d as {
      analytics_token: string
      users: APIUser[]
      read_state: {
        entries: Array<{ id: Snowflake, last_message_id: Snowflake }>
      }
      user: { premium_type?: number }

      // TODO: Verify if this type is truly the case:
      guilds: Array<APIGuild & { channels: APIChannel[], threads: APIChannel[] }>

      user_guild_settings: {
        entries: Array<{
          channel_overrides: Array<{ muted: boolean, channel_id: string }>
        }>
      }
    }

    if (ENABLE_DISCORD_ANALYTICS) api.analyticsToken = d.analytics_token

    api.usernameIDMap = new Map(
      d.users.map(r => [r.username + '#' + r.discriminator, r.id]),
    )
    api.readStateMap = new Map(
      d.read_state.entries.map(readState => [
        readState.id,
        readState.last_message_id,
      ]),
    )

    if (d.user.premium_type !== 0) {
      // User has Discord Nitro ("premium"; can use custom emojis globally), so
      // store them.
      const allEmojis = d.guilds.map(guild => {
        const emojis: DiscordEmoji[] = guild.emojis.map(emoji => ({
          displayName: emoji.name,
          reactionKey: `<:${emoji.name}:${emoji.id}>`,
          url: getEmojiURL(emoji.id, emoji.animated),
        }))

        return [guild.id, emojis] as const
      })
      api.guildCustomEmojiMap = new Map<string, DiscordEmoji[]>(allEmojis)

      api.onGuildCustomEmojiMapUpdate()
    }

    if (ENABLE_GUILDS) {
      const mutedChannels = d.user_guild_settings.entries
        ?.flatMap(entry => entry.channel_overrides)
        .filter(channelOverride => channelOverride.muted)
        .map(channelOverride => channelOverride.channel_id)

      api.mutedChannels = new Set(mutedChannels)

      const allChannels = d.guilds.map(guild => {
        const channels = [...(guild.channels ?? []), ...(guild.threads ?? [])]
          .filter(channel => !IGNORED_CHANNEL_TYPES.has(channel.type))
          .map(channel => mapThread(
            channel,
            api.readStateMap.get(channel.id),
            api.mutedChannels.has(channel.id),
            api.currentUser,
          ))

        return [guild.id, channels] as const
      })
      api.channelsMap = new Map(allChannels)
    }

    api.ready = true
    texts.log('[discord] Pumped READY')
  })

  api.gatewayEvents.on(GatewayMessageType.READY_SUPPLEMENTAL, message => {
    const d = message.d as {
      merged_presences: {
        friends?: Array<GatewayPresenceUpdateData & { user_id: Snowflake }>
      }
    }

    api.usersPresence = Object.fromEntries(
      d.merged_presences.friends?.map(presence => [
        presence.user_id,
        mapPresence(presence.user_id, presence),
      ]),
    )
  })
}
