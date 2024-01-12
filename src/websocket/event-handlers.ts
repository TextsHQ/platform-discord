import { texts, ServerEvent, ServerEventType, Message, ActivityType, UserPresence } from '@textshq/platform-sdk'

import { Snowflake } from 'discord-api-types/globals'
import { APIUser, APIGuild, APIChannel, GatewayPresenceUpdateData, APIEmoji, ChannelType } from 'discord-api-types/v9'
import { IGNORED_CHANNEL_TYPES } from '../constants'
import { mapThread, mapPresence, mapUser, mapMessage, mapReaction } from '../mappers/mappers'
import type DiscordNetworkAPI from '../network-api'
import { ENABLE_DISCORD_ANALYTICS, ENABLE_GUILDS } from '../preferences'
import { DiscordEmoji } from '../types/discord-types'
import { getEmojiURL } from '../util'
import { GatewayMessageType } from './constants'

export function attachReadyHandlers(api: DiscordNetworkAPI) {
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

export function attachGuildHandlers(api: DiscordNetworkAPI) {
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

export function attachMessageHandlers(api: DiscordNetworkAPI) {
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
    api.readStateMap.set(threadID, d.message_id)
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

export function attachChannelHandlers(api: DiscordNetworkAPI) {
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

export function attachReactionHandlers(api: DiscordNetworkAPI) {
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

export function attachRecipientHandlers(api: DiscordNetworkAPI) {
  api.gatewayEvents.on(GatewayMessageType.CHANNEL_RECIPIENT_ADD, ({ d }) => {
    api.eventCallback([{
      type: ServerEventType.STATE_SYNC,
      mutationType: 'upsert',
      objectName: 'participant',
      objectIDs: {
        threadID: d.channel_id,
      },
      entries: [mapUser(d.user)],
    }])
  })

  api.gatewayEvents.on(GatewayMessageType.CHANNEL_RECIPIENT_REMOVE, ({ d }) => {
    api.eventCallback([{
      type: ServerEventType.THREAD_MESSAGES_REFRESH,
      threadID: d.channel_id,
    }])
  })
}

export function attachRelationshipHandlers(api: DiscordNetworkAPI) {
  api.gatewayEvents.on(GatewayMessageType.RELATIONSHIP_ADD, ({ d }) => {
    if (!api.userFriends.find(f => f.id === d.id)) {
      const user = mapUser(d.user)
      api.userFriends.push(user)
    }
  })

  api.gatewayEvents.on(GatewayMessageType.RELATIONSHIP_REMOVE, ({ d }) => {
    const index = api.userFriends.findIndex(f => f.id === d.id)
    if (index >= 0) api.userFriends.splice(index, 1)
  })
}
