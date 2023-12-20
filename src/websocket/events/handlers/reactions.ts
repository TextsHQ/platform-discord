import { ServerEventType, UserPresence } from '@textshq/platform-sdk'
import { mapReaction, mapPresence } from '../../../mappers/mappers'
import type DiscordNetworkAPI from '../../../network-api'
import { ENABLE_GUILDS } from '../../../preferences'
import { GatewayMessageType } from '../../constants'

export default function attachReactionHandlers(api: DiscordNetworkAPI) {
  api.gatewayEvents.on(GatewayMessageType.MESSAGE_REACTION_ADD, ({ d }) => {
    if (!ENABLE_GUILDS && d.guild_id) return

    api.eventCallback([{
      type: ServerEventType.STATE_SYNC,
      mutationType: 'upsert',
      objectName: 'message_reaction',
      objectIDs: {
        threadID: d.channel_id,
        messageID: d.message_id,
      },
      entries: [mapReaction(d, d.user_id)],
    }])
  })

  function handleMessageReactionRemove({ d }: any) {
    if (!ENABLE_GUILDS && d.guild_id) return

    api.eventCallback([{
      type: ServerEventType.STATE_SYNC,
      mutationType: 'delete',
      objectName: 'message_reaction',
      objectIDs: {
        threadID: d.channel_id,
        messageID: d.message_id,
      },
      entries: [`${d.user_id}${d.emoji.name || d.emoji.id}`],
    }])
  }

  // TOOD: Add support for listening to multiple events with a single function.
  api.gatewayEvents.on(GatewayMessageType.MESSAGE_REACTION_REMOVE_EMOJI, handleMessageReactionRemove)
  api.gatewayEvents.on(GatewayMessageType.MESSAGE_REACTION_REMOVE, handleMessageReactionRemove)

  api.gatewayEvents.on(GatewayMessageType.MESSAGE_REACTION_REMOVE_ALL, ({ d }) => {
    if (!ENABLE_GUILDS && d.guild_id) return

    api.eventCallback([{
      type: ServerEventType.STATE_SYNC,
      mutationType: 'update',
      objectName: 'message',
      objectIDs: { threadID: d.channel_id },
      entries: [{
        id: d.message_id,
        reactions: [],
      }],
    }])
  })

  api.gatewayEvents.on(GatewayMessageType.PRESENCE_UPDATE, ({ d }) => {
    if (!ENABLE_GUILDS && d.guild_id) return

    const presence: UserPresence = mapPresence(d.user.id, d)
    api.usersPresence[d.user.id] = presence

    api.eventCallback([{
      type: ServerEventType.USER_PRESENCE_UPDATED,
      presence,
    }])
  })
}
