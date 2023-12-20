import { APIChannel, APIEmoji, APIGuild } from 'discord-api-types/v9'
import { ServerEvent, ServerEventType } from '@textshq/platform-sdk'

import type DiscordNetworkAPI from '../../../network-api'
import { ENABLE_GUILDS } from '../../../preferences'
import { IGNORED_CHANNEL_TYPES } from '../../../constants'
import { mapThread } from '../../../mappers/mappers'
import { getEmojiURL } from '../../../util'
import { GatewayMessageType } from '../../constants'
import { DiscordEmoji } from '../../../types/discord-types'

export default function attachGuildHandlers(api: DiscordNetworkAPI) {
  api.gatewayEvents.on(GatewayMessageType.GUILD_CREATE, ({ d }) => {
    if (api.guildCustomEmojiMap) {
      const guild = d as APIGuild
      const emojis: DiscordEmoji[] = guild.emojis.map(e => ({
        displayName: e.name ?? e.id!,
        reactionKey: `<:${e.name}:${e.id}>`,
        url: getEmojiURL(e.id!, e.animated),
      }))
      api.guildCustomEmojiMap.set(guild.id, emojis)
      api.onGuildCustomEmojiMapUpdate()

      const emojiEvent: ServerEvent = {
        type: ServerEventType.STATE_SYNC,
        objectIDs: {},
        mutationType: 'upsert',
        objectName: 'custom_emoji',
        entries: guild.emojis.map(e => ({
          id: e.id!,
          url: getEmojiURL(e.id!, e.animated),
        })),
      }

      api.eventCallback([emojiEvent])
    }

    if (!ENABLE_GUILDS) return

    const channels = (d.channels as APIChannel[])
      .filter(c => !IGNORED_CHANNEL_TYPES.has(c.type))
      .map(c => mapThread(c, api.readStateMap.get(c.id), api.mutedChannels.has(c.id), api.currentUser))

    api.channelsMap?.set(d.id, channels)

    const channelEvents: ServerEvent[] = channels.map(c => ({
      type: ServerEventType.STATE_SYNC,
      mutationType: 'upsert',
      objectName: 'thread',
      objectIDs: {},
      entries: [c],
    }))

    api.eventCallback(channelEvents)
  })

  api.gatewayEvents.on(GatewayMessageType.GUILD_DELETE, ({ d }) => {
    api.guildCustomEmojiMap?.delete(d.id)
    api.onGuildCustomEmojiMapUpdate()
    // TODO: State sync

    if (!ENABLE_GUILDS) return

    const channelIDs = api.channelsMap?.get(d.id)?.map(c => c.id)
    if (!channelIDs) return

    const events: ServerEvent[] = channelIDs.map(id => ({
      type: ServerEventType.STATE_SYNC,
      mutationType: 'delete',
      objectName: 'thread',
      objectIDs: {},
      entries: [id],
    }))
    api.eventCallback(events)

    api.channelsMap?.delete(d.id)
  })

  api.gatewayEvents.on(GatewayMessageType.GUILD_EMOJIS_UPDATE, ({ d }) => {
    if (!api.guildCustomEmojiMap) return

    const emojis = d.emojis.map((e: APIEmoji) => ({
      displayName: e.name,
      reactionKey: `<:${e.name}:${e.id}>`,
      url: getEmojiURL(e.id!, e.animated),
    }))
    api.guildCustomEmojiMap.set(d.guild_id, emojis)
    api.onGuildCustomEmojiMapUpdate()
  })
}
