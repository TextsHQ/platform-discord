import { ChannelType } from 'discord-api-types/v9'
import { ServerEventType } from '@textshq/platform-sdk'

import type DiscordNetworkAPI from '../../../network-api'
import { mapThread } from '../../../mappers/mappers'
import { GatewayMessageType } from '../../constants'
import { ENABLE_GUILDS } from '../../../preferences'

export default function attachChannelHandlers(api: DiscordNetworkAPI) {
  api.gatewayEvents.on(GatewayMessageType.CHANNEL_CREATE, ({ d }) => {
    if (!ENABLE_GUILDS && d.guild_id) return

    if (d.type !== ChannelType.DM && d.type !== ChannelType.GroupDM) {
      return
    }

    const textsChannel = mapThread(
      d,
      api.readStateMap.get(d.id),
      api.mutedChannels.has(d.id),
      api.currentUser,
    )

    api.eventCallback([{
      type: ServerEventType.STATE_SYNC,
      mutationType: 'upsert',
      objectName: 'thread',
      objectIDs: {},
      entries: [textsChannel],
    }])
  })

  api.gatewayEvents.on(GatewayMessageType.CHANNEL_UPDATE, ({ d }) => {
    if (!ENABLE_GUILDS && d.guild_id) return

    const channels = api.channelsMap?.get(d.guild_id)
    if (!channels) return

    const index = channels.findIndex(c => c.id === d.id)
    if (index < 0) return

    const channel = channels[index]
    const newChannel = mapThread(d, api.readStateMap.get(d.id), api.mutedChannels.has(d.id), api.currentUser)
    Object.assign(channel, newChannel)
    channels[index] = channel
    api.channelsMap?.set(d.guild_id, channels)

    api.eventCallback([{
      type: ServerEventType.STATE_SYNC,
      mutationType: 'update',
      objectName: 'thread',
      objectIDs: {},
      entries: [channel],
    }])
  })

  api.gatewayEvents.on(GatewayMessageType.CHANNEL_DELETE, ({ d }) => {
    if (!ENABLE_GUILDS && d.guild_id) return

    api.eventCallback([{
      type: ServerEventType.STATE_SYNC,
      mutationType: 'delete',
      objectName: 'thread',
      objectIDs: {},
      entries: [d.id],
    }])
  })
}
