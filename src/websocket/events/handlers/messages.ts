import { ServerEventType, Message, texts, ActivityType } from '@textshq/platform-sdk'
import { APIUser } from 'discord-api-types/v9'

import { mapUser, mapMessage } from '../../../mappers/mappers'
import type DiscordNetworkAPI from '../../../network-api'
import { ENABLE_GUILDS } from '../../../preferences'
import { GatewayMessageType } from '../../constants'

export default function attachMessageHandlers(api: DiscordNetworkAPI) {
  api.gatewayEvents.on(GatewayMessageType.MESSAGE_CREATE, ({ d }) => {
    if (!ENABLE_GUILDS && d.guild_id) return

    d.mentions.forEach((m: APIUser) => api.usernameIDMap.set((m.username + '#' + m.discriminator), m.id))

    if (ENABLE_GUILDS && d.author) {
      const sender = mapUser(d.author)
      api.eventCallback([{
        type: ServerEventType.STATE_SYNC,
        mutationType: 'upsert',
        objectName: 'participant',
        objectIDs: {
          threadID: d.channel_id,
        },
        entries: [sender],
      }])
    }

    if (api.sendMessageNonces.has(d.nonce)) {
      api.sendMessageNonces.delete(d.nonce)
    } else {
      // only send upsert message if message was sent from another client/device
      // this is to prevent 2 messages from showing for a split second in somecases
      // (prevents sending ServerEvent before sendMessage() resolves)
      api.eventCallback([{
        type: ServerEventType.STATE_SYNC,
        mutationType: 'upsert',
        objectName: 'message',
        objectIDs: { threadID: d.channel_id },
        entries: [mapMessage(d, api.currentUser?.id) as Message],
      }])
    }
  })

  api.gatewayEvents.on(GatewayMessageType.MESSAGE_UPDATE, ({ d }) => {
    if (!ENABLE_GUILDS && d.guild_id) return

    let mapped = d

    const og = texts.getOriginalObject?.('discord', api.accountID!, ['message', d.id])
    if (og) {
      const ogParsed = JSON.parse(og)
      Object.assign(ogParsed, d)
      mapped = ogParsed
    }

    const message = mapMessage(mapped, api.currentUser?.id)
    if (!message) return

    api.eventCallback([{
      type: ServerEventType.STATE_SYNC,
      mutationType: 'update',
      objectName: 'message',
      objectIDs: { threadID: mapped.channel_id },
      entries: [message],
    }])
  })

  api.gatewayEvents.on(GatewayMessageType.MESSAGE_DELETE, ({ d }) => {
    if (!ENABLE_GUILDS && d.guild_id) return

    api.eventCallback([{
      type: ServerEventType.STATE_SYNC,
      mutationType: 'delete',
      objectName: 'message',
      objectIDs: { threadID: d.channel_id },
      entries: [d.id],
    }])
  })

  api.gatewayEvents.on(GatewayMessageType.MESSAGE_DELETE_BULK, ({ d }) => {
    if (!ENABLE_GUILDS && d.guild_id) return

    api.eventCallback([{
      type: ServerEventType.STATE_SYNC,
      mutationType: 'delete',
      objectName: 'message',
      objectIDs: { threadID: d.channel_id },
      entries: d.ids,
    }])
  })

  api.gatewayEvents.on(GatewayMessageType.MESSAGE_ACK, ({ d }) => {
    if (!ENABLE_GUILDS && d.guild_id) return
    const threadID = d.channel_id
    this.readStateMap.set(threadID, d.message_id)
    api.eventCallback([{
      type: ServerEventType.STATE_SYNC,
      mutationType: 'update',
      objectName: 'thread',
      objectIDs: {},
      entries: [{ id: threadID, isUnread: d.ack_type === 0, lastReadMessageID: d.message_id }],
    }])
  })

  api.gatewayEvents.on(GatewayMessageType.TYPING_START, ({ d }) => {
    if (!ENABLE_GUILDS && d.guild_id) return

    api.eventCallback([{
      type: ServerEventType.USER_ACTIVITY,
      activityType: ActivityType.TYPING,
      durationMs: 10_000,
      participantID: d.user_id,
      threadID: d.channel_id,
    }])
  })
}
