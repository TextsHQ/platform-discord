import { texts } from '@textshq/platform-sdk'
import type { APIGuild, APIUser, Snowflake } from 'discord-api-types/v9'
import type DiscordNetworkAPI from './network-api'
import { GatewayMessage } from './websocket/types'
import { GatewayMessageType } from './websocket/constants'
import { ENABLE_DISCORD_ANALYTICS, ENABLE_GUILDS } from './preferences'
import { getEmojiURL } from './util'
import { DiscordEmoji } from './types/discord-types'
import { IGNORED_CHANNEL_TYPES } from './constants'
import { mapThread } from './mappers/mappers'

/**
 * The main downstream consumer of Discord Gateway events.
 *
 * This mostly dispatches server events (to Texts) and keeps internal state
 * pristine. Handling of low-level Gateway events such as heartbeating is
 * already taken care of by {@link WSClient}.
 */
export function serverEventPump(
  api: DiscordNetworkAPI,
  message: GatewayMessage,
) {
  const { op, d, t } = message

  switch (t) {
    case GatewayMessageType.READY:
      handleReady(api, message)
      break
    default:
      // TODO: Clean up logging, so we don't have to duplicate the logging
      // prefix here.
      texts.log(
        `[discord] Gateway event is going unhandled by server event pump (op: ${op}, t: ${t})`,
        d,
      )
  }
}

function handleReady(api: DiscordNetworkAPI, message: GatewayMessage) {
  // Assert the structure of `READY`. fragile (!)
  // TOOD: Move this to another file.
  const d = message.d as {
    analytics_token: string
    users: APIUser[]
    read_state: { entries: Array<{ id: Snowflake, last_message_id: Snowflake }> }
    user: { premium_type?: number }
    guilds: APIGuild[]
    user_guild_settings: {
      entries: Array<{ channel_overrides: Array<{ muted: boolean, channel_id: string }> }>
    }
  }

  if (ENABLE_DISCORD_ANALYTICS) api.analyticsToken = d.analytics_token

  api.usernameIDMap = new Map(
    d.users.map(r => [
      r.username + '#' + r.discriminator,
      r.id,
    ]),
  )
  api.readStateMap = new Map(
    d.read_state.entries.map(
      readState => [
        readState.id,
        readState.last_message_id,
      ],
    ),
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
      // @ts-expect-error
      const channels = [...(guild.channels ?? []), ...(guild.threads ?? [])]
        .filter(c => !IGNORED_CHANNEL_TYPES.has(c.type))
        .map(c =>
          mapThread(
            c,
            api.readStateMap.get(c.id),
            api.mutedChannels.has(c.id),
            api.currentUser,
          ))
      return [guild.id, channels] as const
    })
    api.channelsMap = new Map(allChannels)
  }

  api.ready = true
  texts.log('[discord] Pumped READY')
}
