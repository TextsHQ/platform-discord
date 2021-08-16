import { promises as fs } from 'fs'
import path from 'path'
import FormData from 'form-data'
import { uniqBy } from 'lodash'
import { texts, CurrentUser, MessageContent, PaginationArg, Thread, Message, ServerEventType, OnServerEventCallback, ActivityType, User, InboxName, MessageSendOptions, ReAuthError, PresenceMap, Paginated, FetchOptions, ServerEvent, CustomEmojiMap } from '@textshq/platform-sdk'

import { getEmojiURL, mapChannel, mapCurrentUser, mapMessage, mapReaction, mapThread, mapUser } from './mappers'
import WSClient from './websocket/wsclient'
import { GatewayCloseCode, GatewayMessageType } from './websocket/constants'
import { defaultPacker } from './packers'
import { IGNORED_CHANNEL_TYPES } from './constants'
import { generateSnowflake, sleep } from './util'
import { ACT_AS_USER, ENABLE_GUILDS, ENABLE_DM_GUILD_MEMBERS } from './preferences'
import type { DiscordEmoji } from './types'

const API_VERSION = 9
const API_ENDPOINT = `https://discord.com/api/v${API_VERSION}`
const DEFAULT_GATEWAY = 'wss://gateway.discord.gg'

const SLEEP_INTERVAL = 100

const WAIT_TILL_READY = true // wait until received initial data?
const RESTART_ON_FAIL = true // restart platform when failed?

const getErrorMessage = (res: { statusCode: number, json?: any }): string => res.json?.message || `Invalid response: ${res.statusCode}`

export default class DiscordNetworkAPI {
  private client?: WSClient

  private httpClient = texts.createHttpClient()

  // ID-to-username mappings
  private readonly userMappings = new Map<string, string>()

  private readonly readStateMap = new Map<string, string>()

  private readonly channelsMap? = ENABLE_GUILDS ? new Map<string, Thread[]>() : undefined

  private readonly sendMessageNonces = new Set<string>()

  private readonly usersPresence: PresenceMap = {}

  // key is guild id
  private guildCustomEmojiMap?: Map<string, DiscordEmoji[]>

  private allCustomEmojis?: DiscordEmoji[]

  private mutedChannels = new Set<string>()

  private lastAckToken?: string = null

  private gotInitialUserData = false

  token?: string

  eventCallback?: OnServerEventCallback

  startPolling?: () => void

  stopPolling?: () => void

  ready = false

  currentUser?: CurrentUser

  userFriends: User[] = []

  login = async (token: string) => {
    if (!token) throw new Error('No token found.')
    this.token = token
    this.setupWebsocket()
  }

  logout = async () => {
    this.fetch({ method: 'POST', url: 'auth/logout', json: { provider: null, voip_provider: null } })
    this.client = null
  }

  dispose = () => {
    this.ready = false
    this.client?.disconnect()
    this.client = null
  }

  setupWebsocket = async () => {
    const gatewayRes = await this.httpClient.requestAsString(`${API_ENDPOINT}/gateway`, { headers: { 'User-Agent': texts.constants.USER_AGENT } })
    const gatewayHost = JSON.parse(gatewayRes?.body)?.url as string ?? DEFAULT_GATEWAY
    const gatewayFullURL = `${gatewayHost}/?v=${API_VERSION}&encoding=${defaultPacker.encoding}`

    this.client = new WSClient(gatewayFullURL, this.token, ENABLE_GUILDS, ACT_AS_USER, defaultPacker)
    texts.log('[discord ws] URL:', gatewayFullURL)
    this.client.restartOnFail = RESTART_ON_FAIL

    this.setupGatewayListeners()
  }

  getCurrentUser = async (): Promise<CurrentUser> => {
    const res = await this.fetch({ method: 'GET', url: 'users/@me' })
    if (res.statusCode < 200 || res.statusCode > 204 || !res.json) throw new Error(getErrorMessage(res))

    const currentUser = mapCurrentUser(res.json)
    this.currentUser = currentUser
    if (currentUser.id && currentUser.displayText) this.userMappings.set(currentUser.id, currentUser.displayText)

    this.getUserFriends()

    return currentUser
  }

  getThreads = async (inboxName: InboxName, pagination?: PaginationArg): Promise<Paginated<Thread>> => {
    await this.waitForInitialData()

    const res = await this.fetch({ method: 'GET', url: 'users/@me/channels' })
    if (res.statusCode < 200 || res.statusCode > 204 || !res.json) throw new Error(getErrorMessage(res))

    const threads: Thread[] = res.json
      .sort((a, b) => a.last_message_id - b.last_message_id)
      .reverse()
      .map(thread => mapThread(thread, this.readStateMap.get(thread.id), this.currentUser))

    threads.flatMap(t => t.participants.items).forEach(p => this.userMappings.set(p.id, p.username))

    // TODO: App doesn't display empty channels
    const items = ENABLE_GUILDS ? threads.concat([...this.channelsMap?.values()].flat()) : threads
    return { items, hasMore: false }
  }

  createThread = async (userIDs: string[], title?: string): Promise<boolean | Thread> => {
    if (userIDs.length === 1 && userIDs[0] === this.currentUser?.id) return false
    await this.waitUntilReady()

    const res = await this.fetch({
      method: 'POST',
      url: 'users/@me/channels',
      json: userIDs.length === 1 ? { recipient_id: userIDs[0] } : { recipients: userIDs },
    })

    if (res.statusCode < 200 || res.statusCode > 204 || !res.json) throw new Error(getErrorMessage(res))
    return mapThread(res.json, null, this.currentUser, this.userMappings)
  }

  /** https://discord.com/developers/docs/resources/channel#deleteclose-channel */
  archiveThread = async (threadID: string) => {
    await this.fetch({ method: 'DELETE', url: `channels/${threadID}` })
  }

  getMessage = async (message: any, threadID: string) => {
    const reactionsDetails = message.reactions
      ? await Promise.all(message.reactions.map(async r => {
        const emojiQuery = encodeURIComponent(r.emoji.id ? `${r.emoji.name}:${r.emoji.id}` : r.emoji.name)
        const reactedRes = await this.fetch({ method: 'GET', url: `channels/${threadID}/messages/${message.id}/reactions/${emojiQuery}` })
        const users = reactedRes?.json
        return users ? { emoji: r.emoji, users } : null
      }))
      : undefined
    return mapMessage(message, this.currentUser.id, reactionsDetails)
  }

  getMessages = async (threadID: string, pagination?: PaginationArg) => {
    if (!this.currentUser) throw new Error('No current user')
    await this.waitUntilReady()

    const options = {
      before: (pagination?.direction === 'before') ? pagination?.cursor : undefined,
      after: (pagination?.direction === 'after') ? pagination?.cursor : undefined,
    }

    const paginationQuery = options.before ? `before=${options.before}` : options.after ? `after=${options.after}` : ''
    const res = await this.fetch({ method: 'GET', url: `channels/${threadID}/messages?limit=50&${paginationQuery}` })
    if (res.statusCode < 200 || res.statusCode > 204 || !res.json) throw new Error(getErrorMessage(res))

    const messages: Message[] = await Promise.all(res.json.map(m => this.getMessage(m, threadID)))

    if (ENABLE_GUILDS) {
      // Guilds don't return all users, so we need to keep it updated using message authors
      const users: User[] = res.json.map(m => {
        const user = mapUser(m.author)
        user.cannotMessage = !ENABLE_DM_GUILD_MEMBERS
        return user
      })
      const entries = uniqBy(users, 'id')

      const authorEvents: ServerEvent[] = [{
        type: ServerEventType.STATE_SYNC,
        mutationType: 'upsert',
        objectName: 'participant',
        objectIDs: { threadID },
        entries,
      }]
      this.eventCallback?.(authorEvents)
    }

    return messages.filter(Boolean).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }

  sendMessage = async (threadID: string, content: MessageContent, options?: MessageSendOptions) => {
    await this.waitUntilReady()

    const text = this.mapMentionsAndEmojis(content.text)

    const requestContent = {
      headers: {},
      message_reference: undefined,
      json: undefined,
      body: undefined,
    }

    if (options?.quotedMessageID) requestContent.message_reference = { message_id: options?.quotedMessageID }

    const nonce = generateSnowflake().toString()
    this.sendMessageNonces.add(nonce)

    if (content.fileBuffer || content.filePath) {
      const form = new FormData()
      if (content.fileBuffer) {
        form.append('file', content.fileBuffer, {
          filename: content.fileName,
          knownLength: content.fileBuffer?.length,
        })
      } else if (content.filePath) {
        form.append('file', await fs.readFile(content.filePath), {
          filename: content.fileName || path.basename(content.filePath),
        })
      }

      const payload_json = {
        content: text || '',
        tts: false,
        message_reference: requestContent.message_reference,
        nonce,
      }
      form.append('payload_json', JSON.stringify(payload_json))

      requestContent.headers = form.getHeaders()
      requestContent.body = form
    } else {
      requestContent.headers = { 'Content-Type': 'application/json' }
      requestContent.json = {
        content: text,
        tts: false,
        nonce,
        message_reference: requestContent.message_reference,
      }
    }

    const res = await this.fetch({
      url: `channels/${threadID}/messages`,
      method: 'POST',
      headers: requestContent.headers,
      json: requestContent.json,
      body: requestContent.body,
    })

    if (res.statusCode < 200 || res.statusCode > 204 || !res.json) throw Error(getErrorMessage(res))
    return [mapMessage(res.json, this.currentUser.id)]
  }

  editMessage = async (threadID: string, messageID: string, content: MessageContent, options?: MessageSendOptions): Promise<boolean> => {
    await this.waitUntilReady()

    const text = this.mapMentionsAndEmojis(content.text)

    const res = await this.fetch({ url: `channels/${threadID}/messages/${messageID}`, method: 'PATCH', json: { content: text } })
    if (res.statusCode < 200 || res.statusCode > 204) throw Error(getErrorMessage(res))
    return true
  }

  patchChannel = async (channelID: string, patches: { name?: string, icon?: string }) => {
    const res = await this.fetch({ url: `channels/${channelID}`, method: 'PATCH', json: patches })
    if (res.statusCode < 200 || res.statusCode > 204) throw Error(getErrorMessage(res))
    return true
  }

  deleteMessage = async (threadID: string, messageID: string, forEveryone?: boolean): Promise<boolean> => {
    if (!forEveryone) return false
    await this.waitUntilReady()

    const res = await this.fetch({ method: 'DELETE', url: `channels/${threadID}/messages/${messageID}` })
    if (res.statusCode < 200 || res.statusCode > 204) throw Error(getErrorMessage(res))
    return true
  }

  sendReadReceipt = async (threadID: string, messageID?: string) => {
    await this.waitUntilReady()

    const res = await this.fetch({ method: 'POST', url: `channels/${threadID}/messages/${messageID}/ack`, json: { token: this.lastAckToken } })
    this.lastAckToken = res.json?.token

    if (res.statusCode < 200 || res.statusCode > 204) throw Error(getErrorMessage(res))
    this.readStateMap.set(threadID, messageID)
  }

  addReaction = async (threadID: string, messageID: string, reactionKey: string): Promise<boolean> => {
    await this.waitUntilReady()

    const emoji = this.allCustomEmojis?.find(e => e.displayName === reactionKey)
    // eslint-disable-next-line no-param-reassign
    if (emoji) reactionKey = emoji.reactionKey.slice(2, -1)

    const res = await this.fetch({ method: 'PUT', url: `channels/${threadID}/messages/${messageID}/reactions/${encodeURIComponent(reactionKey)}/@me` })
    if (res.statusCode < 200 || res.statusCode > 204) throw Error(getErrorMessage(res))
    return true
  }

  removeReaction = async (threadID: string, messageID: string, reactionKey: string): Promise<boolean> => {
    await this.waitUntilReady()

    const emoji = this.allCustomEmojis?.find(e => e.displayName === reactionKey)
    // eslint-disable-next-line no-param-reassign
    if (emoji) reactionKey = emoji.reactionKey.slice(2, -1)

    const res = await this.fetch({ method: 'DELETE', url: `channels/${threadID}/messages/${messageID}/reactions/${encodeURIComponent(reactionKey)}/@me` })
    if (res.statusCode < 200 || res.statusCode > 204) throw Error(getErrorMessage(res))
    return true
  }

  setTyping = async (type: ActivityType, threadID: string): Promise<void> => {
    if (type === ActivityType.TYPING && this.ready) this.fetch({ method: 'POST', url: `channels/${threadID}/typing` })
  }

  getUsersPresence = async () => {
    await this.waitForInitialData()
    return this.usersPresence
  }

  onGuildCustomEmojiMapUpdate = () => {
    this.allCustomEmojis = Array.from(this.guildCustomEmojiMap.values()).flat()
  }

  getCustomEmojis = async (): Promise<CustomEmojiMap> => {
    await this.waitForInitialData()
    if (!this.allCustomEmojis) return {}

    const emojis = this.allCustomEmojis.map(e => [e.displayName, e.url])
    return Object.fromEntries(emojis)
  }

  private getUserFriends = async () => {
    const res = await this.fetch({ method: 'GET', url: 'users/@me/relationships' })
    if (res.statusCode < 200 || res.statusCode > 204 || !res.json) throw Error(getErrorMessage(res))
    this.userFriends = res.json
      .filter(f => f.type === 1) // Only friends
      .map(f => mapUser(f.user))
  }

  private mapMentionsAndEmojis = (text: string): string => {
    const userMappings = Array.from(this.userMappings.values())
    const mentionRegex = /@([^#@]{3,32}#[0-9]{4})/gi
    const emojiRegex = /:([a-zA-Z0-9-]*)(~\d*)?:/gi

    return text
      // @ts-expect-error replaceAll
      ?.replaceAll(mentionRegex, (_, username) => { // mentions
        const user = userMappings.find(u => u === username)
        if (user) return `<@!${user[0]}>`
        return username
      })
      .replaceAll(emojiRegex, match => { // emojis
        const emoji = this.allCustomEmojis?.find(e => `:${e.displayName}:` === match)
        if (emoji) return emoji.reactionKey
        return match
      })
  }

  private setupGatewayListeners = () => {
    if (!this.client) throw new Error('[discord ws] not initialized!')

    this.client.onChangedReadyState = ready => {
      texts.log('[discord ws] Connection state: ' + ready)
      this.ready = ready
    }

    this.client.onConnectionClosed = (code, reason) => {
      texts.log('[discord ws] Connection to websocket closed with code', code + '. Reason:', reason)
      this.ready = false

      switch (code) {
        case GatewayCloseCode.ADDRESS_NOT_FOUND:
          this.startPolling?.()
          break
        case GatewayCloseCode.RECONNECT_REQUESTED:
          texts.log('[discord ws] Gateway requested client reconnect.')
          break
        case GatewayCloseCode.AUTHENTICATION_FAILED:
          this.client = null
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw new ReAuthError('Access token invalid')
        case GatewayCloseCode.SESSION_TIMED_OUT:
          texts.log('[discord ws] Gateway session timed out.')
          break
        default:
          break
      }
    }

    this.client.onError = error => {
      texts.Sentry.captureException(error)
    }

    this.client.onMessage = this.handleGatewayMessage
  }

  private handleGatewayMessage = (opcode, payload, type) => {
    // texts.log('[discord ws]', opcode, type)

    switch (type) {
      // * Documented

      case GatewayMessageType.HELLO: {
        // handled by WSClient
        break
      }

      case GatewayMessageType.READY: {
        // const notes = payload.notes
        // const user_settings = payload.user_settings

        if (ACT_AS_USER) {
          payload.users?.forEach(r => this.userMappings.set(r.id, (r.username + '#' + r.discriminator)))
          payload.read_state?.entries?.forEach(p => this.readStateMap.set(p.id, p.last_message_id))
          // presences are in READY_SUPPLEMENTAL if ACT_AS_USER = true

          if (payload.user.premium_type && payload.user.premium_type !== 0) {
            // User has nitro, so store emojis
            this.guildCustomEmojiMap = new Map<string, DiscordEmoji[]>()
            payload.guilds.forEach(g => {
              const emojis = g.emojis.map(e => ({
                displayName: e.name,
                reactionKey: `<:${e.name}:${e.id}>`,
                url: getEmojiURL(e.id, e.animated),
              }))
              this.guildCustomEmojiMap.set(g.id, emojis)
            })
            this.onGuildCustomEmojiMapUpdate()
          }
        } else {
          payload.relationships?.forEach(r => this.userMappings.set(r.id, (r.user.username + '#' + r.user.discriminator)))
          payload.read_state?.forEach(p => this.readStateMap.set(p.id, p.last_message_id))
          payload.presences?.forEach(p => {
            this.usersPresence[p.user.id] = { userID: p.user.id, isActive: p.status === 'online', lastActive: new Date(+p.last_modified) }
          })
        }

        if (ENABLE_GUILDS) {
          const mutedChannels = (ACT_AS_USER ? payload.user_guild_settings.entries : payload.user_guild_settings)
            ?.flatMap(g => g.channel_overrides)
            .filter(g => g.muted)
            .map(g => g.channel_id)
          this.mutedChannels = new Set(mutedChannels)

          payload.guilds.forEach(guild => {
            const guildID: string = guild.id
            const guildName: string = guild.name
            // const guildJoinDate: Date = new Date(guild.joined_at)
            // const guildIconID: string | undefined = guild.icon

            const channels = guild.channels.concat(guild.threads)
              .filter(c => !IGNORED_CHANNEL_TYPES.has(c.type))
              .map(c => mapChannel(c, this.mutedChannels.has(c.id), guildName))

            this.channelsMap.set(guildID, channels)
          })
        }

        this.gotInitialUserData = true
        this.ready = true
        break
      }

      case GatewayMessageType.READY_SUPPLEMENTAL: {
        payload.merged_presences.friends?.forEach(p => {
          this.usersPresence[p.user_id] = { userID: p.user_id, isActive: p.status === 'online', lastActive: new Date(+p.last_modified) }
        })
        break
      }

      case GatewayMessageType.RESUMED: {
        // TODO: RESUMED
        texts.log(type, payload)
        break
      }

      case GatewayMessageType.RECONNECT: {
        // TODO: RECONNECT
        texts.log(type, payload)
        break
      }

      case GatewayMessageType.INVALID_SESSION: {
        // TODO: INVALID_SESSION
        texts.log(type, payload)
        break
      }

      case GatewayMessageType.CHANNEL_CREATE: {
        if (!ENABLE_GUILDS && payload.guild_id) return

        const channel = mapChannel(payload, this.mutedChannels.has(payload.id))
        const channels = this.channelsMap?.get(payload.guild_id)?.concat([channel])
        if (channels) {
          this.channelsMap?.set(payload.guild_id, channels)

          this.eventCallback?.([{
            type: ServerEventType.STATE_SYNC,
            mutationType: 'upsert',
            objectName: 'thread',
            objectIDs: {
              threadID: payload.id,
            },
            entries: [channel],
          }])
        }
        break
      }

      case GatewayMessageType.CHANNEL_UPDATE: {
        if (!ENABLE_GUILDS && payload.guild_id) return

        const channels = this.channelsMap?.get(payload.guild_id)
        const index = channels.findIndex(c => c.id === payload.id)
        if (index < 0) return

        const channel = channels[index]
        const newChannel = mapChannel(payload, this.mutedChannels.has(payload.id))
        Object.assign(channel, newChannel)
        channels[index] = channel
        this.channelsMap?.set(payload.guild_id, channels)

        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'update',
          objectName: 'thread',
          objectIDs: {
            threadID: payload.id,
          },
          entries: [channel],
        }])
        break
      }

      case GatewayMessageType.CHANNEL_DELETE: {
        if (!ENABLE_GUILDS && payload.guild_id) return

        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'delete',
          objectName: 'thread',
          objectIDs: {
            threadID: payload.id,
          },
          entries: [payload.id],
        }])
        break
      }

      case GatewayMessageType.CHANNEL_PINS_UPDATE: {
        // TODO: CHANNEL_PINS_UPDATE
        texts.log(type, payload)
        break
      }

      case GatewayMessageType.THREAD_CREATE: {
        // TODO: THREAD_CREATE
        texts.log(type, payload)
        break
      }

      case GatewayMessageType.THREAD_UPDATE: {
        // TODO: THREAD_UPDATE
        texts.log(type, payload)
        break
      }

      case GatewayMessageType.THREAD_DELETE: {
        // TODO: THREAD_DELETE
        texts.log(type, payload)
        break
      }

      case GatewayMessageType.THREAD_LIST_SYNC: {
        // TODO: THREAD_LIST_SYNC
        texts.log(type, payload)
        break
      }

      case GatewayMessageType.THREAD_MEMBER_UPDATE: {
        // TODO: THREAD_MEMBER_UPDATE
        texts.log(type, payload)
        break
      }

      case GatewayMessageType.THREAD_MEMBERS_UPDATE: {
        // TODO: THREAD_MEMBERS_UPDATE
        texts.log(type, payload)
        break
      }

      case GatewayMessageType.GUILD_CREATE: {
        const emojis = payload.emojis.map(e => ({
          displayName: e.name,
          reactionKey: `<:${e.name}:${e.id}>`,
          url: getEmojiURL(e.id, e.animated),
        }))
        this.guildCustomEmojiMap.set(payload.id, emojis)
        this.onGuildCustomEmojiMapUpdate()

        const emojiEvent: ServerEvent = {
          type: ServerEventType.STATE_SYNC,
          objectIDs: {},
          mutationType: 'upsert',
          objectName: 'custom_emoji',
          entries: emojis,
        }

        if (!ENABLE_GUILDS) {
          this.eventCallback?.([emojiEvent])
          return
        }

        const channels = payload.channels
          .filter(c => !IGNORED_CHANNEL_TYPES.has(c.type))
          .map(c => mapChannel(c, this.mutedChannels.has(c.id)), payload.name)

        this.channelsMap?.set(payload.id, channels)

        const channelEvents: ServerEvent[] = channels.map(c => ({
          type: ServerEventType.STATE_SYNC,
          mutationType: 'upsert',
          objectName: 'thread',
          objectIDs: {
            threadID: c.id,
          },
          entries: [c],
        }))

        this.eventCallback?.([emojiEvent, ...channelEvents])
        break
      }

      case GatewayMessageType.GUILD_DELETE: {
        this.guildCustomEmojiMap?.delete(payload.id)
        this.onGuildCustomEmojiMapUpdate()
        // TODO: State sync

        if (!ENABLE_GUILDS) return

        const channelIDs = this.channelsMap.get(payload.id).map(c => c.id)
        const events: ServerEvent[] = channelIDs.map(id => ({
          type: ServerEventType.STATE_SYNC,
          mutationType: 'delete',
          objectName: 'thread',
          objectIDs: {
            threadID: id,
          },
          entries: [id],
        }))
        this.eventCallback?.(events)

        this.channelsMap.delete(payload.id)
        break
      }

      case GatewayMessageType.GUILD_EMOJIS_UPDATE: {
        if (!this.guildCustomEmojiMap) return

        const emojis = payload.emojis.map(e => ({
          displayName: e.name,
          reactionKey: `<:${e.name}:${e.id}>`,
          url: getEmojiURL(e.id, e.animated),
        }))
        this.guildCustomEmojiMap.set(payload.guild_id, emojis)
        this.onGuildCustomEmojiMapUpdate()
        // TODO: State sync

        break
      }

      case GatewayMessageType.MESSAGE_CREATE: {
        if (!ENABLE_GUILDS && payload.guild_id) return

        payload.mentions.forEach(m => this.userMappings.set(m.id, (m.username + '#' + m.discriminator)))

        if (ENABLE_GUILDS && payload.author) {
          const sender = mapUser(payload.author)
          this.eventCallback?.([{
            type: ServerEventType.STATE_SYNC,
            mutationType: 'upsert',
            objectName: 'participant',
            objectIDs: {
              threadID: payload.channel_id,
            },
            entries: [sender],
          }])
        }

        if (this.sendMessageNonces.has(payload.nonce)) {
          this.sendMessageNonces.delete(payload.nonce)
        } else {
          // only send upsert message if message was sent from another client/device
          // this is to prevent 2 messages from showing for a split second in somecases
          // (prevents sending ServerEvent before sendMessage() resolves)
          this.eventCallback?.([{
            type: ServerEventType.STATE_SYNC,
            mutationType: 'upsert',
            objectName: 'message',
            objectIDs: {
              threadID: payload.channel_id,
              messageID: payload.id,
            },
            entries: [mapMessage(payload, this.currentUser?.id)],
          }])
        }
        break
      }

      case GatewayMessageType.MESSAGE_UPDATE: {
        if (!ENABLE_GUILDS && payload.guild_id) return

        // when ACT_AS_USER = false, discord sends this event with payload.content === ''
        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'update',
          objectName: 'message',
          objectIDs: { threadID: payload.channel_id },
          entries: [mapMessage(payload, this.currentUser.id)],
        }])
        break
      }

      case GatewayMessageType.MESSAGE_DELETE: {
        if (!ENABLE_GUILDS && payload.guild_id) return

        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'delete',
          objectName: 'message',
          objectIDs: {
            threadID: payload.channel_id,
            messageID: payload.id,
          },
          entries: [payload.id],
        }])
        break
      }

      case GatewayMessageType.MESSAGE_DELETE_BULK: {
        if (!ENABLE_GUILDS && payload.guild_id) return

        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'delete',
          objectName: 'message',
          objectIDs: {
            threadID: payload.channel_id,
          },
          entries: payload.ids,
        }])
        break
      }

      case GatewayMessageType.MESSAGE_REACTION_ADD: {
        if (!ENABLE_GUILDS && payload.guild_id) return

        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'upsert',
          objectName: 'message_reaction',
          objectIDs: {
            threadID: payload.channel_id,
            messageID: payload.message_id,
          },
          entries: [mapReaction(payload, payload.user_id)],
        }])
        break
      }

      case GatewayMessageType.MESSAGE_REACTION_REMOVE:
      case GatewayMessageType.MESSAGE_REACTION_REMOVE_EMOJI: {
        if (!ENABLE_GUILDS && payload.guild_id) return

        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'delete',
          objectName: 'message_reaction',
          objectIDs: {
            threadID: payload.channel_id,
            messageID: payload.message_id,
          },
          entries: [`${payload.user_id}${payload.emoji.name || payload.emoji.id}`],
        }])
        break
      }

      case GatewayMessageType.MESSAGE_REACTION_REMOVE_ALL: {
        if (!ENABLE_GUILDS && payload.guild_id) return

        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'update',
          objectName: 'message',
          objectIDs: {
            threadID: payload.channel_id,
          },
          entries: [{
            id: payload.message_id,
            reactions: [],
          }],
        }])
        break
      }

      case GatewayMessageType.PRESENCE_UPDATE: {
        if (payload.guild_id) return

        this.usersPresence[payload.user.id] = { userID: payload.user.id, isActive: payload.status === 'online', lastActive: new Date(payload.last_modified) }
        this.eventCallback?.([{
          type: ServerEventType.USER_PRESENCE_UPDATED,
          presence: {
            userID: payload.user.id,
            isActive: payload.status === 'online',
            lastActive: new Date(),
          },
        }])
        break
      }

      case GatewayMessageType.TYPING_START: {
        if (!ENABLE_GUILDS && payload.guild_id) return

        this.eventCallback?.([{
          type: ServerEventType.USER_ACTIVITY,
          activityType: ActivityType.TYPING,
          durationMs: 10_000,
          participantID: payload.user_id,
          threadID: payload.channel_id,
        }])
        break
      }

      case GatewayMessageType.USER_UPDATE: {
        // TODO: USER_UPDATE
        texts.log(type, payload)
        break
      }

      // * Undocumented

      case GatewayMessageType.CHANNEL_UNREAD_UPDATE: {
        // TODO: CHANNEL_UNREAD_UPDATE
        texts.log(type, payload)
        break
      }

      case GatewayMessageType.MESSAGE_ACK: {
        if (!ENABLE_GUILDS && payload.guild_id) return

        const threadID = payload.channel_id
        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'update',
          objectName: 'thread',
          objectIDs: {
            threadID,
          },
          entries: [{ id: threadID, isUnread: false }],
        }])
        break
      }

      case GatewayMessageType.RELATIONSHIP_ADD: {
        if (!this.userFriends.find(f => f.id === payload.id)) {
          const user = mapUser(payload.user)
          this.userFriends.push(user)
        }
        break
      }

      case GatewayMessageType.RELATIONSHIP_REMOVE: {
        const index = this.userFriends.findIndex(f => f.id === payload.id)
        if (index >= 0) this.userFriends.splice(index, 1)
        break
      }

      // * Defaults

      case GatewayMessageType.APPLICATION_COMMAND_CREATE:
      case GatewayMessageType.APPLICATION_COMMAND_UPDATE:
      case GatewayMessageType.APPLICATION_COMMAND_DELETE:
      case GatewayMessageType.GUILD_UPDATE:
      case GatewayMessageType.GUILD_BAN_ADD:
      case GatewayMessageType.GUILD_BAN_REMOVE:
      case GatewayMessageType.GUILD_APPLICATION_COMMAND_COUNTS_UPDATE:
      case GatewayMessageType.GUILD_INTEGRATIONS_UPDATE:
      case GatewayMessageType.GUILD_MEMBER_ADD:
      case GatewayMessageType.GUILD_MEMBER_REMOVE:
      case GatewayMessageType.GUILD_MEMBER_UPDATE:
      case GatewayMessageType.GUILD_MEMBERS_CHUNK:
      case GatewayMessageType.GUILD_ROLE_CREATE:
      case GatewayMessageType.GUILD_ROLE_UPDATE:
      case GatewayMessageType.GUILD_ROLE_DELETE:
      case GatewayMessageType.INTEGRATION_CREATE:
      case GatewayMessageType.INTEGRATION_UPDATE:
      case GatewayMessageType.INTEGRATION_DELETE:
      case GatewayMessageType.INTERACTION_CREATE:
      case GatewayMessageType.INVITE_CREATE:
      case GatewayMessageType.INVITE_DELETE:
      case GatewayMessageType.VOICE_STATE_UPDATE:
      case GatewayMessageType.VOICE_SERVER_UPDATE:
      case GatewayMessageType.WEBHOOKS_UPDATE:
      case GatewayMessageType.CHANNEL_PINS_ACK:
      case GatewayMessageType.SESSIONS_REPLACE:
      case null: {
        break
      }

      default: {
        texts.log('[discord ws] Unhandled', opcode, type, payload)
        break
      }
    }
  }

  private waitForInitialData = async () => {
    while (!this.gotInitialUserData && WAIT_TILL_READY) await sleep(SLEEP_INTERVAL)
  }

  private waitUntilReady = async () => {
    while (!this.ready && WAIT_TILL_READY) await sleep(SLEEP_INTERVAL)
  }

  private fetch = async ({ url, headers = {}, json, ...rest }: FetchOptions & { url: string, json?: any }): Promise<{ statusCode: number; json?: any }> => {
    try {
      const opts: FetchOptions = {
        // TODO: timeout: 10000,
        ...rest,
        body: json ? JSON.stringify(json) : rest.body,
        headers: {
          'User-Agent': texts.constants.USER_AGENT,
          Authorization: this.token,
          ...headers,
        },
      }
      if (json) opts.headers['Content-Type'] = 'application/json'

      const res = await this.httpClient.requestAsString(`${API_ENDPOINT}/${url}`, opts)
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      if (res.statusCode === 401) throw new ReAuthError('Unauthorized')
      const responseJSON = res.body?.length ? JSON.parse(res.body) : undefined
      return {
        statusCode: res.statusCode,
        json: responseJSON,
      }
    } catch (err) {
      if (err.code === 'ECONNREFUSED' && (err.message.endsWith('0.0.0.0:443') || err.message.endsWith('127.0.0.1:443'))) {
        texts.error('Discord is blocked')
        throw new Error('Discord seems to be blocked on your device. This could have been done by an app or a manual entry in /etc/hosts')
      } else if (err.code === 'ENOTFOUND') {
        this.startPolling?.()
      } else {
        throw err
      }
    }
  }
}
