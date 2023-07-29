import * as Texts from '@textshq/platform-sdk'
import { ExpectedJSONGotHTMLError } from '@textshq/platform-sdk/dist/json'
import FormData from 'form-data'
import { readFile as fsReadFile } from 'fs/promises'
import { basename as pathBasename } from 'path'

import { DISCORD_API_ENDPOINT, DISCORD_API_VERSION, DISCORD_DEFAULT_GATEWAY, DISCORD_ENABLE_ANALYTICS, LOG_PREFIX } from '@'
import { PLATFORM_NAME } from './info'
import { defaultPacker } from '@/packers'
import * as Util from '@/util'
import * as Gateway from '@/gateway'
import * as GatewayPayload from '@/gateway/types/payloads'
import * as DiscordTypes from './types/Discord'
import * as DiscordAPI from './types/Discord/api'
import * as DiscordGatewayMessage from '@/types/Discord/gateway'
import * as TextsTypes from '@/types/Texts'
import * as DiscordMappers from '@/mappers/Discord'
import * as TextsMappers from '@/mappers/Texts'
import * as DiscordConstants from '@/discord-constants'

const WS_OPTIONS: Gateway.ConnectionOptions = {
  version: DISCORD_API_VERSION,
  encoding: defaultPacker!.encoding,
  // compress: defaultPacker!.compress ? 'zlib-stream' : undefined,
}

interface DiscordNetworkAPIConfig {
  enableGuilds: boolean
  customChannels?: { id: string, name?: string }[]
}

class DiscordNetworkAPI {
  // HTTP client
  private readonly httpClient = Texts.texts.createHttpClient!()

  // Discord Gateway client
  private gatewayClient?: Gateway.GatewayClient

  private unreadThreads: Set<TextsTypes.Thread['id']> = new Set()

  private mutedThreads: Map<TextsTypes.Thread['id'], TextsTypes.Thread['mutedUntil']> = new Map()

  private guildThreads: Map<TextsTypes.Thread['id'], TextsTypes.Thread> = new Map()

  private readonly sentMessagesNonces: Set<string> = new Set()

  private analytics: { token?: string, deviceFingerprint?: string } = {}

  private lastAck: { token?: string | null, lastViewed?: number } = {
    token: null,
    lastViewed: undefined,
  }

  // Current account ID
  accountID?: string

  config: DiscordNetworkAPIConfig = {
    enableGuilds: false,
  }

  currentUser?: DiscordTypes.CurrentUser

  // Authentication token
  token?: string

  // Is gateway ready and listening?
  ready = false

  pendingEventsQueue: Texts.ServerEvent[] = []

  eventCallback: Texts.OnServerEventCallback = (events: Texts.ServerEvent[]) => {
    this.pendingEventsQueue.push(...events)
  }

  usersPresence: Texts.PresenceMap = {}

  // Sets up authorization & connects to the gateway
  login = async (token?: string) => {
    if (!token) throw new Error('No token found.')
    this.token = token

    await this.connectToGateway()

    if (DISCORD_ENABLE_ANALYTICS) {
      const fingerprintRes = await this.fetch<DiscordAPI.Auth.Fingerprint.Response>('auth/fingerprint', { method: 'POST' })
      this.analytics.deviceFingerprint = fingerprintRes?.json?.fingerprint
    }
  }

  // Fetches members for specified thread, if it belongs to a guild.
  onThreadSelected = async (threadID?: Texts.ThreadID) => {
    if (!threadID) return

    const _thread = Texts.texts.getOriginalObject(PLATFORM_NAME, this.accountID!, ['thread', threadID])
    if (_thread) {
      const thread = JSON.parse(_thread) as DiscordTypes.Channel
      if ('guild_id' in thread && thread.guild_id) {
        await this.requestGuildMembers(thread.guild_id, threadID)
      }
    }

    // await this.sendScienceRequest(ScienceEventType.channel_opened, { channel_id: threadID })
  }

  // Get current user's details.
  getCurrentUser = async (): Promise<TextsTypes.CurrentUser | undefined> => {
    const res = await this.fetch<DiscordAPI.Users.Me.Response>('users/@me', { method: 'GET', checkError: true })
    if (!res?.json) {
      throw new Error(`Failed to get current user: ${res?.statusCode}`)
    }

    this.currentUser = res.json
    const mapped = DiscordMappers.mapUser(res.json)
    return {
      displayText: mapped.fullName,
      ...mapped,
    }
  }

  // Get current user's friends.
  /* getUserFriends = async () => {
    const res = await this.fetch<ResUsersMeRelationships>('users/@me/relationships', { method: 'GET', checkError: true })
    if (!res.json) {
      throw new Error(`Failed to get friends: ${res.statusCode}`)
    }

    const userFriends = res.json
      .filter(f => f.type === UserRelationshipType.friends)
      .map(f => mapUser(f.user))

    // this.sendScienceRequest(ScienceEventType.dm_list_viewed)
  } */

  // Get threads.
  getThreads = async (folderName: Texts.ThreadFolderName, pagination?: Texts.PaginationArg): Promise<Texts.Paginated<TextsTypes.Thread>> => {
    const res = await this.fetch<DiscordAPI.Users.Me.Channels.Response>('users/@me/channels', { method: 'GET', checkError: true })
    if (!res?.json) {
      throw new Error(`Failed to get threads: ${res?.statusCode}`)
    }

    const threads: TextsTypes.Thread[] = res.json
      .map(DiscordMappers.mapChannel)
      .filter(c => !!c?.id) as TextsTypes.Thread[]

    // const customThreads: TextsThread[] = (this.config.customChannels ?? [])
    //   .map(({ id, name }) => ({
    //     id,
    //     title: name ?? id,
    //     isUnread: this.unreadThreadsSet.has(id) ?? false,
    //     isReadOnly: false,
    //     type: 'channel',
    //     messages: { items: [], hasMore: true },
    //     participants: { items: [], hasMore: true },
    //     timestamp: new Date(0),
    //   }))

    const items: TextsTypes.Thread[] = [...threads, ...this.guildThreads.values()]
      .map(c => ({
        ...c,
        isUnread: this.unreadThreads?.has(c.id) ?? false,
        mutedUntil: this.mutedThreads?.get(c.id),
      }))
      .sort((a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0))

    return { items, hasMore: false }

    // return { items: [...this.threads?.values() ?? []], hasMore: !this.threads }
  }

  updateThread = async (threadID: Texts.ThreadID, updates: Partial<TextsTypes.Thread>) => {
    const json: DiscordAPI.Channels.Thread.Request | undefined = TextsMappers.mapPartialThread(updates)

    const res = await this.fetch<DiscordAPI.Channels.Thread.Response>(`channels/${threadID}`, { method: 'PATCH', checkError: true, json })
    if (!res?.json) {
      throw new Error(`Failed to get threads: ${res?.statusCode}`)
    }

    const newChannel = DiscordMappers.mapChannel(res.json)
    if (newChannel) {
      const newChannelUpdateEvent: Texts.UpdateStateSyncEvent = {
        type: Texts.ServerEventType.STATE_SYNC,
        mutationType: 'update',
        objectName: 'thread',
        objectIDs: {},
        entries: [newChannel],
      }
      this.eventCallback([newChannelUpdateEvent])
    }
  }

  // Get messages in specified thread.
  getMessages = async (threadID: Texts.ThreadID, pagination?: Texts.PaginationArg): Promise<Texts.Paginated<TextsTypes.Message>> => {
    if (!this.currentUser) throw new Error('No current user!')

    const options = {
      before: (pagination?.direction === 'before') ? pagination?.cursor : undefined,
      after: (pagination?.direction === 'after') ? pagination?.cursor : undefined,
    }

    const messagesCountLimit = 50
    const paginationQuery = options.before ? `before=${options.before}` : options.after ? `after=${options.after}` : ''
    const url = `channels/${threadID}/messages?limit=${messagesCountLimit}&${paginationQuery}`

    const res = await this.fetch<DiscordAPI.Channels.Thread.Messages.Response.GET>(url, { method: 'GET', checkError: true })
    if (!res?.json) {
      throw new Error(`Failed to get messages: ${res?.statusCode}`)
    }

    const messages = res.json
      .map(m => {
        const mapped = DiscordMappers.mapMessage(m)
        return {
          ...mapped,
          isSender: m.author.id === this.currentUser?.id,
          accountID: this.accountID,
        }
      })
      .sort((a, b) => +a.id - +b.id)

    // TODO: hasMore
    return { items: messages, hasMore: true }

    /*
    const json: DiscordMessage[] = res!.json
    const messages = (await Promise.all(json.map(m => this.getMessageReactions(m, threadID)))).filter(Boolean) as Message[]

    if (ENABLE_GUILDS) {
      // Guilds don't return all users, so we need to keep it updated using message authors
      const users: User[] = json.map(m => {
        const user = mapUser(m.author)
        user.cannotMessage = !ENABLE_DM_GUILD_MEMBERS
        return user
      })
      const entries = uniqBy(users, 'id')

      const authorEvents: ServerEvent[] = [{
        mutationType: 'upsert',
        type: ServerEventType.STATE_SYNC,
        objectName: 'participant',
        objectIDs: { threadID },
        entries,
      }]
      this.eventCallback(authorEvents)
    }

    return messages.sort((a, b) => (a!.timestamp?.getTime() ?? 0) - (b!.timestamp?.getTime() ?? 0))
    */
  }

  sendMessage = async (threadID: Texts.ThreadID, content: Texts.MessageContent, options?: Texts.MessageSendOptions): Promise<boolean | TextsTypes.Message[]> => {
    // TODO: Parsing mentions & emotes

    const nonce = options?.pendingMessageID?.includes('-') ? Util.generateSnowflake().toString() : options?.pendingMessageID as string
    this.sentMessagesNonces.add(nonce)

    // const text = content.text ? this.mapMentionsAndEmojis(content.text) : undefined
    const text = content.text

    const json = {
      content: text ?? '',
      nonce,
      message_reference: options?.quotedMessageID ? { message_id: options?.quotedMessageID } : undefined,
    }

    const payload: { headers?: { [key: string]: string }, json?: any, body?: Buffer } = {}

    if (content.fileBuffer || content.filePath) {
      const form = new FormData()
      if (content.fileBuffer) {
        form.append('file', content.fileBuffer, {
          filename: content.fileName,
          contentType: content.mimeType,
          knownLength: content.fileBuffer?.length,
        })
      } else if (content.filePath) {
        const fileBuffer = await fsReadFile(content.filePath)
        form.append('file', fileBuffer, {
          filename: content.fileName || pathBasename(content.filePath),
          contentType: content.mimeType,
          knownLength: fileBuffer.length,
        })
      }

      form.append('payload_json', JSON.stringify(json), { contentType: 'application/json' })

      payload.headers = form.getHeaders()
      payload.body = form.getBuffer()
    } else {
      payload.headers = { 'Content-Type': 'application/json' }
      payload.json = json
    }

    try {
      const res = await this.fetch<DiscordAPI.Channels.Thread.Messages.Response.POST>(`channels/${threadID}/messages`, {
        method: 'POST',
        headers: payload.headers,
        json: payload.json,
        body: payload.body,
        checkError: true,
      })

      if (!res?.json?.id) {
        this.sentMessagesNonces.delete(nonce)
        throw new Error(`Failed to send message: ${res?.statusCode} (${(res?.json as any)?.code})`)
      }

      const mapped = DiscordMappers.mapMessage(res.json)
      return [{
        ...mapped,
        isSender: res.json.author.id === this.currentUser?.id,
        accountID: this.accountID,
      }]
    } catch (error) {
      this.sentMessagesNonces.delete(nonce)
      throw error
    }
  }

  // Delete message with specified id in specified thread.
  deleteMessage = async (threadID: Texts.ThreadID, messageID: Texts.MessageID) => {
    const res = await this.fetch<undefined>(`channels/${threadID}/messages/${messageID}`, { method: 'DELETE', checkError: true })
    if (res?.statusCode !== 204) throw new Error(`Failed to delete message: ${res?.statusCode}`)
  }

  // Send typing indicator in specified thread.
  sendTypingIndicator = async (threadID: Texts.ThreadID) => {
    const res = await this.fetch<undefined>(`channels/${threadID}/typing`, { method: 'POST', checkError: true })
    if (res?.statusCode !== 204) throw new Error(`Failed to send typing indicator: ${res?.statusCode}`)
  }

  // Send read receipt for specified message in specified thread.
  sendReadReceipt = async (threadID: Texts.ThreadID, messageID?: Texts.MessageID, messageCursor?: string) => {
    let _messageID = messageID
    if (!_messageID) {
      const _thread = Texts.texts.getOriginalObject(PLATFORM_NAME, this.accountID!, ['thread', threadID])
      if (_thread) {
        const thread = JSON.parse(_thread) as DiscordTypes.Channel
        _messageID = thread.last_message_id
      }
    }

    const json: DiscordAPI.Channels.Thread.Messages.Ack.Request = {
      token: this.lastAck.token,
      last_viewed: this.lastAck.lastViewed,
    }
    const res = await this.fetch<DiscordAPI.Channels.Thread.Messages.Ack.Response>(`channels/${threadID}/messages/${_messageID}/ack`, {
      method: 'POST',
      checkError: true,
      json,
    })

    if (!res?.json) {
      throw new Error(`Failed to send read receipt: ${res?.statusCode}`)
    }

    this.lastAck.token = res.json.token
  }

  // Request members for specified thread belonging to specified guild.
  private requestGuildMembers = async (guildID: string, channelID: Texts.ThreadID) => {
    // TODO: Work this out
    if (!this.gatewayClient) throw Error('GatewayClient not ready!')

    const fromIndex = 0
    const toIndex = 99
    const gatewayMessage: Gateway.Message<GatewayPayload.RequestGuildDetails> = {
      op: Gateway.OPCode._LAZY_REQUEST,
      d: {
        guild_id: guildID,
        activities: true,
        threads: true,
        typing: true,
        channels: {
          [channelID]: [
            [fromIndex, toIndex],
          ],
        },
      },
    }
    this.gatewayClient.send(gatewayMessage)
  }

  // Connects to the gateway.
  private connectToGateway = async (force = false, resume = false) => {
    if (this.gatewayClient && this.gatewayClient.ready) {
      if (force) {
        Texts.texts.log(LOG_PREFIX, 'Force connect!')
        this.gatewayClient.disconnect()
      } else {
        Texts.texts.log(LOG_PREFIX, 'connect() called, but already has client.')
        return
      }
    }

    Texts.texts.log(LOG_PREFIX, 'Connecting to gateway...')

    if (!this.gatewayClient) {
      const headers = { 'User-Agent': Texts.texts.constants.USER_AGENT }
      const gatewayRes = await this.httpClient.requestAsString(`${DISCORD_API_ENDPOINT}/gateway`, { headers })
      const gatewayHost = JSON.parse(gatewayRes?.body)?.url as string ?? DISCORD_DEFAULT_GATEWAY
      this.gatewayClient = new Gateway.GatewayClient(gatewayHost, this.token!, defaultPacker!, WS_OPTIONS)
    }

    this.gatewayClient.shouldResume = resume

    this.gatewayClient.onChangedReadyState = ready => {
      Texts.texts.log(`${LOG_PREFIX} Client connection state: ${ready}`)
      this.ready = ready
    }

    this.gatewayClient.onConnectionClosed = (code, reason) => {
      this.ready = false

      const toastEvent: Texts.ToastEvent = {
        type: Texts.ServerEventType.TOAST,
        toast: {
          id: 'GatewayClosedToast',
          text: reason ? `Gateway closed with reason '${reason}'.` : `Gateway closed with code ${code}`,
        },
      }
      this.eventCallback([toastEvent])

      switch (code) {
        case Gateway.CloseCode.ADDRESS_NOT_FOUND: {
          Texts.texts.log(LOG_PREFIX, 'Gateway connection closed due to network connection loss.')
          // this.startPolling?.()
          break
        }

        case Gateway.CloseCode.AUTHENTICATION_FAILED: {
          Texts.texts.log(LOG_PREFIX, 'Gateway connection closed due to authentication failure.')
          this.gatewayClient?.disconnect()
          this.gatewayClient = undefined
          throw new Texts.ReAuthError('Access token invalid')
        }

        case Gateway.CloseCode.SESSION_TIMED_OUT: {
          Texts.texts.log(`${LOG_PREFIX} Gateway session timed out`)
          break
        }

        default: {
          break
        }
      }
    }

    this.gatewayClient.onError = error => {
      Texts.texts.Sentry.captureException(error)
    }

    this.gatewayClient.onMessage = this.onGatewayMessage

    this.gatewayClient.connect()
  }

  // Gateway message handler.
  private onGatewayMessage = ({ op, d, s, t }: Gateway.Message<any>) => {
    // console.log(t, JSON.stringify(d, undefined, 4))
    switch (t) {
      case null: {
        // Doesn't interest us
        break
      }
      case Gateway.MessageType.HELLO: {
        // Handled by GatewayClient
        break
      }
      case Gateway.MessageType.READY: {
        const _d = d as DiscordGatewayMessage.Ready

        const allServerEvents: Texts.ServerEvent[] = []

        if (this.gatewayClient && _d.resume_gateway_url) {
          this.gatewayClient.url = _d.resume_gateway_url
        }

        // const allThreads = _d.private_channels.map(DiscordMappers.mapPrivateChannel)
        if (this.config.enableGuilds) {
          const guildThreads = _d.guilds
            .flatMap(guild => {
              const channels = DiscordMappers.mapGuildChannels(guild)
                .map(channel => ({
                  ...channel,
                  isUnread: this.unreadThreads?.has(channel.id),
                  mutedUntil: this.mutedThreads?.get(channel.id),
                }))
              return channels
            })
          this.guildThreads = new Map(guildThreads.map(thread => [thread.id, thread]))
          // const guildThreadsEvents: UpsertStateSyncEvent[] = guildThreads.map(entry => ({
          //   type: ServerEventType.STATE_SYNC,
          //   mutationType: 'upsert',
          //   objectName: 'thread',
          //   objectIDs: {},
          //   entries: [entry],
          // }))
          // allServerEvents.push(...guildThreadsEvents)
        }

        const mutedChannels: { id: TextsTypes.Thread['id'], mutedUntil: TextsTypes.Thread['mutedUntil'] }[] = _d.user_guild_settings.entries
          .flatMap(guild => {
            const guildMutedChannels = guild.channel_overrides
              .filter(channel => channel.muted)
              .map(channel => {
                const mutedUntil: TextsTypes.Thread['mutedUntil'] = channel.mute_config ? (channel.mute_config.selected_time_window === -1 ? 'forever' : (channel.mute_config.end_time ? new Date(channel.mute_config.end_time) : undefined)) : undefined
                return { id: channel.channel_id, mutedUntil }
              })
            return guildMutedChannels
          })
        this.mutedThreads = new Map(mutedChannels.map(c => [c.id, c.mutedUntil]))
        // const mutedChannelsEvents: Texts.UpdateStateSyncEvent[] = mutedChannels.map(entry => ({
        //   type: Texts.ServerEventType.STATE_SYNC,
        //   mutationType: 'update',
        //   objectName: 'thread',
        //   objectIDs: {},
        //   entries: [
        //     { id: entry.id, mutedUntil: entry.mutedUntil },
        //   ],
        // }))
        // allServerEvents.push(...mutedChannelsEvents)
        const mutedChannelsEvent: Texts.UpdateStateSyncEvent = {
          type: Texts.ServerEventType.STATE_SYNC,
          mutationType: 'update',
          objectName: 'thread',
          objectIDs: {},
          entries: mutedChannels,
        }
        allServerEvents.push(mutedChannelsEvent)

        const unreadThreads = _d.read_state.entries
          .filter(entry => entry.mention_count > 0)
        this.unreadThreads = new Set(unreadThreads.map(entry => entry.id))
        // const readStatesEvents: Texts.UpdateStateSyncEvent[] = unreadThreads.map(entry => ({
        //   type: Texts.ServerEventType.STATE_SYNC,
        //   mutationType: 'update',
        //   objectName: 'thread',
        //   objectIDs: {},
        //   entries: [
        //     {
        //       id: entry.id,
        //       isUnread: entry.mention_count > 0,
        //       partialLastMessage: { id: entry.last_message_id },
        //     },
        //   ],
        // }))
        // allServerEvents.push(...readStatesEvents)
        const readStatesEvent: Texts.UpdateStateSyncEvent = {
          type: Texts.ServerEventType.STATE_SYNC,
          mutationType: 'update',
          objectName: 'thread',
          objectIDs: {},
          entries: unreadThreads.map(entry => ({
            id: entry.id,
            isUnread: entry.mention_count > 0,
            partialLastMessage: { id: entry.last_message_id },
          })),
        }
        allServerEvents.push(readStatesEvent)

        // TODO: Get nicknames from _d.relationships[].nickname

        this.eventCallback(allServerEvents)

        break
      }
      case Gateway.MessageType._READY_SUPPLEMENTAL: {
        const _d = d as DiscordGatewayMessage.ReadySupplemental

        const allServerEvents: Texts.ServerEvent[] = []

        const userPresences = _d.merged_presences.friends.map(DiscordMappers.mapUserPresence)
        userPresences.forEach(p => { this.usersPresence[p.userID] = p })

        const userPresenceEvents: Texts.UserPresenceEvent[] = userPresences.map(presence => ({
          type: Texts.ServerEventType.USER_PRESENCE_UPDATED,
          presence,
        }))
        allServerEvents.push(...userPresenceEvents)

        this.eventCallback(allServerEvents)

        break
      }
      case Gateway.MessageType.RESUMED: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.RECONNECT: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.INVALID_SESSION: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.APPLICATION_COMMAND_CREATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.APPLICATION_COMMAND_UPDATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.APPLICATION_COMMAND_DELETE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.CHANNEL_CREATE: {
        const _d = d as DiscordGatewayMessage.ChannelCreate
        if (!this.config.enableGuilds && _d.guild_id) return

        const mapped = DiscordMappers.mapGuildChannel(_d)
        if (mapped) {
          this.guildThreads.set(mapped.id, mapped)

          const threadEvent: Texts.UpsertStateSyncEvent = {
            type: Texts.ServerEventType.STATE_SYNC,
            mutationType: 'upsert',
            objectName: 'thread',
            objectIDs: {},
            entries: [mapped],
          }
          this.eventCallback([threadEvent])
        }

        break
      }
      case Gateway.MessageType.CHANNEL_UPDATE: {
        const _d = d as DiscordGatewayMessage.ChannelUpdate
        if (!this.config.enableGuilds && _d.guild_id) return

        const _mapped = DiscordMappers.mapGuildChannel(_d)
        if (_mapped) {
          const mapped = {
            ...this.guildThreads.get(_d.id),
            ..._mapped,
          }
          this.guildThreads.set(mapped.id, mapped)

          const threadEvent: Texts.UpdateStateSyncEvent = {
            type: Texts.ServerEventType.STATE_SYNC,
            mutationType: 'update',
            objectName: 'thread',
            objectIDs: {},
            entries: [mapped],
          }
          this.eventCallback([threadEvent])
        }

        break
      }
      case Gateway.MessageType.CHANNEL_DELETE: {
        const _d = d as DiscordGatewayMessage.ChannelDelete
        if (!this.config.enableGuilds && _d.guild_id) return

        this.guildThreads.delete(_d.id)

        const threadEvent: Texts.DeleteStateSyncEvent = {
          type: Texts.ServerEventType.STATE_SYNC,
          mutationType: 'delete',
          objectName: 'thread',
          objectIDs: {},
          entries: [_d.id],
        }
        this.eventCallback([threadEvent])

        break
      }
      case Gateway.MessageType.CHANNEL_PINS_UPDATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.THREAD_CREATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.THREAD_UPDATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.THREAD_DELETE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.THREAD_LIST_SYNC: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.THREAD_MEMBER_UPDATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.THREAD_MEMBERS_UPDATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.GUILD_CREATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.GUILD_UPDATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.GUILD_DELETE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.GUILD_BAN_ADD: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.GUILD_BAN_REMOVE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.GUILD_EMOJIS_UPDATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.GUILD_INTEGRATIONS_UPDATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.GUILD_MEMBER_ADD: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.GUILD_MEMBER_REMOVE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.GUILD_MEMBER_UPDATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.GUILD_MEMBERS_CHUNK: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.GUILD_ROLE_CREATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.GUILD_ROLE_UPDATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.GUILD_ROLE_DELETE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.GUILD_MEMBER_LIST_UPDATE: {
        console.log(t, d)

        // const _d = d as GatewayMessagePayload.GuildMemberListUpdate

        // if (!this.config.enableGuilds && _d.guild_id) return

        // const threads = [...this.guildThreads.values()].filter(thread => thread.extra?.guildID === _d.guild_id)
        // console.log(threads)

        break
      }
      case Gateway.MessageType.INTEGRATION_CREATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.INTEGRATION_UPDATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.INTEGRATION_DELETE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.INTERACTION_CREATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.INVITE_CREATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.INVITE_DELETE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.MESSAGE_CREATE: {
        const _d = d as DiscordGatewayMessage.MessageCreate

        const allEvents: Texts.ServerEvent[] = []

        if (_d.nonce && this.sentMessagesNonces.has(_d.nonce)) {
          this.sentMessagesNonces.delete(_d.nonce)
        } else {
          // only send upsert message if message was sent from another client/device
          // this is to prevent 2 messages from showing for a split second in somecases
          // (prevents sending ServerEvent before sendMessage() resolves)
          const mapped: Texts.Message = {
            ...DiscordMappers.mapMessage(_d),
            isSender: _d.author.id === this.currentUser?.id,
            accountID: this.accountID,
          }

          const messageEvent: Texts.UpsertStateSyncEvent = {
            type: Texts.ServerEventType.STATE_SYNC,
            mutationType: 'upsert',
            objectName: 'message',
            objectIDs: { threadID: mapped.threadID },
            entries: [mapped],
          }
          allEvents.push(messageEvent)
        }

        const messageTypingEvent: Texts.UserActivityEvent = {
          type: Texts.ServerEventType.USER_ACTIVITY,
          activityType: Texts.ActivityType.TYPING,
          threadID: _d.channel_id,
          participantID: _d.channel_id,
        }
        allEvents.push(messageTypingEvent)

        this.eventCallback(allEvents)

        break
      }
      case Gateway.MessageType.MESSAGE_UPDATE: {
        const _d = d as DiscordGatewayMessage.MessageUpdate

        const mapped: Texts.Message = {
          ...DiscordMappers.mapMessage(_d),
          isSender: _d.author.id === this.currentUser?.id,
          accountID: this.accountID,
        }

        const messageEvent: Texts.UpdateStateSyncEvent = {
          type: Texts.ServerEventType.STATE_SYNC,
          mutationType: 'update',
          objectName: 'message',
          objectIDs: { threadID: mapped.threadID },
          entries: [mapped],
        }
        this.eventCallback([messageEvent])

        break
      }
      case Gateway.MessageType.MESSAGE_DELETE: {
        const _d = d as DiscordGatewayMessage.MessageDelete

        const messageEvent: Texts.DeleteStateSyncEvent = {
          type: Texts.ServerEventType.STATE_SYNC,
          mutationType: 'delete',
          objectName: 'message',
          objectIDs: { threadID: _d.channel_id },
          entries: [_d.id],
        }
        this.eventCallback([messageEvent])

        break
      }
      case Gateway.MessageType.MESSAGE_DELETE_BULK: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.MESSAGE_REACTION_ADD: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.MESSAGE_REACTION_REMOVE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.MESSAGE_REACTION_REMOVE_ALL: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.MESSAGE_REACTION_REMOVE_EMOJI: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.PRESENCE_UPDATE: {
        const _d = d as DiscordTypes.UserPresence

        const presence = DiscordMappers.mapUserPresence(_d)
        this.usersPresence[_d.user_id] = presence

        const userPresenceEvent: Texts.UserPresenceEvent = {
          type: Texts.ServerEventType.USER_PRESENCE_UPDATED,
          presence,
        }
        this.eventCallback([userPresenceEvent])

        break
      }
      case Gateway.MessageType.TYPING_START: {
        const _d = d as DiscordGatewayMessage.TypingStart

        const typingEvent: Texts.UserActivityEvent = {
          type: Texts.ServerEventType.USER_ACTIVITY,
          activityType: Texts.ActivityType.TYPING,
          threadID: _d.channel_id,
          participantID: _d.channel_id,
          durationMs: DiscordConstants.TYPING_DURATION_MS,
        }
        this.eventCallback([typingEvent])

        break
      }
      case Gateway.MessageType.USER_UPDATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.VOICE_STATE_UPDATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.VOICE_SERVER_UPDATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.WEBHOOKS_UPDATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.CHANNEL_RECIPIENT_ADD: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType.CHANNEL_RECIPIENT_REMOVE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType._CHANNEL_PINS_ACK: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType._CHANNEL_UNREAD_UPDATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType._GUILD_APPLICATION_COMMAND_COUNTS_UPDATE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType._MESSAGE_ACK: {
        const _d = d as DiscordGatewayMessage.MessageAck

        this.lastAck.lastViewed = _d.last_viewed

        break
      }
      case Gateway.MessageType._RELATIONSHIP_ADD: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType._RELATIONSHIP_REMOVE: {
        console.log(t, d)
        break
      }
      case Gateway.MessageType._SESSIONS_REPLACE: {
        // Doesn't interest us
        break
      }
    }
  }

  // Discord HTTP request helper
  private fetch = async <D>(requestPath: string, { headers = {}, json, checkError, ...rest }: Texts.FetchOptions & { json?: any, checkError?: boolean }): Promise<{ statusCode: number, json?: D } | undefined> => {
    try {
      const opts: Texts.FetchOptions = {
        // TODO: timeout: 10000,
        ...rest,
        body: json ? JSON.stringify(json) : rest.body,
        headers: {
          'User-Agent': Texts.texts.constants.USER_AGENT,
          Authorization: this.token!,
          // TODO: x-super-proporties
          ...headers,
        },
      }
      if (json) opts.headers!['Content-Type'] = opts.headers?.['Content-Type'] || 'application/json'

      const res = await this.httpClient.requestAsString(`${DISCORD_API_ENDPOINT}/${requestPath}`, opts)
      const { statusCode, body } = res
      if (statusCode === 401) throw new Texts.ReAuthError('Unauthorized')
      const hasBody = body?.length
      if (hasBody && body[0] === '<') {
        Texts.texts.log(LOG_PREFIX, requestPath, statusCode, body)
        throw new ExpectedJSONGotHTMLError(statusCode, body)
      }
      const responseJSON = hasBody ? JSON.parse(body) : undefined
      if (checkError) {
        if (!(statusCode >= 200 && statusCode < 300)) {
          throw new Error(Util.getErrorMessage({ statusCode, json: responseJSON }))
        }
      }
      // if (checkError && (statusCode < 200 || statusCode > 204 || (statusCode !== 204 && !responseJSON))) throw new Error(Util.getErrorMessage(res))
      return {
        statusCode,
        json: responseJSON as D,
      }
    } catch (err: any) {
      if (err.code === 'ECONNREFUSED' && (err.message.endsWith('0.0.0.0:443') || err.message.endsWith('127.0.0.1:443'))) {
        Texts.texts.error('Discord is blocked')
        throw new Error('Discord seems to be blocked on your device. This could have been done by an app or a manual entry in /etc/hosts')
      } else if (err.code === 'ENOTFOUND') {
        // this.startPolling?.()
      } else {
        throw err
      }
    }
  }

  // Send analytics event
  private sendScienceRequest = async (type: DiscordTypes.ScienceEventType, properties?: any) => {
    if (!DISCORD_ENABLE_ANALYTICS) return
    if (!this.analytics.deviceFingerprint || !this.analytics.token) return

    const json: DiscordAPI.Science.Request = {
      events: [{
        type,
        properties: {
          client_uuid: Util.generateScienceClientUUID(this.currentUser?.id),
          client_send_timestamp: Date.now(),
          client_track_timestamp: Date.now(),
          accessibility_support_enabled: false,
          accessibility_features: 128,
          ...properties,
        },
      }],
      token: this.analytics.token,
    }

    const headers = {
      'X-Super-Properties': Buffer.from(JSON.stringify(DiscordConstants.SUPER_PROPERTIES)).toString('base64'),
      'X-Fingerprint': this.analytics.deviceFingerprint,
    }

    Texts.texts.log(LOG_PREFIX, `[science] Sending ${type}`)
    await this.fetch('science', { method: 'POST', json, headers })
  }
}

export default DiscordNetworkAPI
