import path from 'path'
import FormData from 'form-data'
import { promises as fs } from 'fs'
import { uniqBy } from 'lodash'
import { texts, CurrentUser, MessageContent, PaginationArg, Thread, Message, ServerEventType, OnServerEventCallback, ActivityType, User, InboxName, MessageSendOptions, ReAuthError, PresenceMap, Paginated, FetchOptions, ServerEvent, CustomEmojiMap, UserPresence } from '@textshq/platform-sdk'

import { getEmojiURL, mapChannel, mapCurrentUser, mapMessage, mapPresence, mapReaction, mapThread, mapUser } from './mappers'
import WSClient from './websocket/wsclient'
import { GatewayCloseCode, GatewayMessageType, OPCode } from './websocket/constants'
import { defaultPacker } from './packers'
import { IGNORED_CHANNEL_TYPES, ScienceEventType } from './constants'
import { generateScienceClientUUID, generateSnowflake, SUPER_PROPERTIES, sleep } from './util'
import { ENABLE_GUILDS, ENABLE_DM_GUILD_MEMBERS, ENABLE_DISCORD_ANALYTICS } from './preferences'
import type { DiscordEmoji, DiscordMessage, DiscordReactionDetails, DiscordScienceEvent } from './types'

import _emojis from './resources/emojis.json'
import _emojiShortcuts from './resources/shortcuts.json'

const API_VERSION = 9
const API_ENDPOINT = `https://discord.com/api/v${API_VERSION}`
const DEFAULT_GATEWAY = 'wss://gateway.discord.gg'

const SLEEP_INTERVAL = 100

const getErrorMessage = (res: { statusCode: number, json?: any }): string => res.json?.message || `Invalid response: ${res.statusCode}`

export default class DiscordNetworkAPI {
  private client?: WSClient

  private httpClient = texts.createHttpClient()

  private readonly sendMessageNonces = new Set<string>()

  private emojiShortcuts = {
    emojis: new Map<string, string>(_emojis as Iterable<[string, string]>),
    shortcuts: new Map<string, string>(_emojiShortcuts as Iterable<[string, string]>),
  }

  // username-to-id mappings
  private userMappings = new Map<string, string>()

  private readStateMap = new Map<string, string>()

  private channelsMap? = ENABLE_GUILDS ? new Map<string, Thread[]>() : undefined

  // key is guild id
  private guildCustomEmojiMap?: Map<string, DiscordEmoji[]>

  private allCustomEmojis?: DiscordEmoji[]

  private usersPresence: PresenceMap = {}

  private mutedChannels = new Set<string>()

  private lastAckToken?: string = null

  private analyticsToken?: string = null

  private deviceFingerprint?: string = null

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

    if (ENABLE_DISCORD_ANALYTICS) {
      const fingerprintRes = await this.fetch({ method: 'POST', url: 'auth/fingerprint' })
      this.deviceFingerprint = fingerprintRes.json?.fingerprint
    }
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
    if (this.client && !this.client.ready) return

    const gatewayRes = await this.httpClient.requestAsString(`${API_ENDPOINT}/gateway`, { headers: { 'User-Agent': texts.constants.USER_AGENT } })
    const gatewayHost = JSON.parse(gatewayRes?.body)?.url as string ?? DEFAULT_GATEWAY
    const gatewayFullURL = `${gatewayHost}/?v=${API_VERSION}&encoding=${defaultPacker.encoding}`

    this.client = new WSClient(gatewayFullURL, this.token, defaultPacker)
    texts.log('[discord ws] URL:', gatewayFullURL)

    this.client.connect()
    this.setupGatewayListeners()
  }

  getCurrentUser = async (): Promise<CurrentUser> => {
    const res = await this.fetch({ method: 'GET', url: 'users/@me' })
    if (res.statusCode < 200 || res.statusCode > 204 || !res.json) throw new Error(getErrorMessage(res))

    const currentUser = mapCurrentUser(res.json)
    this.currentUser = currentUser
    if (currentUser.id && currentUser.displayText) this.userMappings.set(currentUser.displayText, currentUser.id)

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

    threads.flatMap(t => t.participants.items).forEach(p => this.userMappings.set(p.username, p.id))

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
    return mapThread(res.json, null, this.currentUser)
  }

  /** https://discord.com/developers/docs/resources/channel#deleteclose-channel */
  closeThread = async (threadID: string) => {
    await this.fetch({ method: 'DELETE', url: `channels/${threadID}` })
  }

  blockUser = async (userID: string) => {
    const res = await this.fetch({
      method: 'PUT',
      url: `users/@me/relationships/${userID}`,
      json: { type: 2 },
    })
    return res.statusCode === 204
  }

  reportThread = async (threadID: string, _messageID: string) => {
    // todo review: this getMessages call is untested
    const messageID = _messageID || await this.getMessages(threadID, { direction: 'after', cursor: '0' }).then(m => m[0].id)
    const Referer = `https://discord.com/channels/@me/${threadID}`
    const res1 = await this.fetch({
      url: 'reporting/menu/first_dm',
      headers: {
        Referer,
      },
      method: 'GET',
    })
    const breadcrumb = Object.values<any>(res1.json.nodes).find(n => n.report_type === 'sub_spam')?.id
    const res2 = await this.fetch({
      method: 'POST',
      url: 'reporting/first_dm',
      json: {
        id: String(generateSnowflake()),
        version: '1.0',
        variant: '1',
        language: 'en',
        breadcrumbs: [breadcrumb],
        elements: {},
        name: 'first_dm',
        channel_id: threadID,
        message_id: messageID,
      },
      headers: {
        Referer,
      },
    })
    const success = !!res2.json?.report_id
    // 400 {
    //   message: 'Validation error: 1 validation error for MessageReportSubmission\n' +
    //     'message_id\n' +
    //     '  none is not an allowed value (type=type_error.none.not_allowed)',
    //     code: 0
    // }
    texts.log('[discord] reported thread', res1.statusCode, res1.json, res2.statusCode, res2.json)
    if (success) {
      // this.blockUser(userID).then(result => texts.log('block user', userID, result))
      this.closeThread(threadID)
      this.eventCallback([{
        type: ServerEventType.TOAST,
        toast: {
          text: 'Reported thread to Discord',
        },
      }, {
        type: ServerEventType.STATE_SYNC,
        mutationType: 'delete',
        objectName: 'thread',
        objectIDs: {},
        entries: [threadID],
      }])
    } else {
      this.eventCallback([{
        type: ServerEventType.TOAST,
        toast: {
          text: `Something went wrong while reporting thread: ${res2.json.message}`,
        },
      }])
    }
    return success
  }

  getMessage = async (message: DiscordMessage, threadID: string) => {
    const reactionsDetails: DiscordReactionDetails[] | undefined = message.reactions
      ? await Promise.all(message.reactions.map(async r => {
        const emojiQuery = encodeURIComponent(r.emoji.id ? `${r.emoji.name}:${r.emoji.id}` : r.emoji.name)
        const reactedRes = await this.fetch({ method: 'GET', url: `channels/${threadID}/messages/${message.id}/reactions/${emojiQuery}` })
        const users = reactedRes?.json
        return users ? { emoji: r.emoji, users } : null
      }))
      : undefined
    const mapped = mapMessage(message, this.currentUser.id, reactionsDetails)
    if (mapped.text) mapped.text = this.mapMentionsAndEmojis(mapped.text, false)
    return mapped
  }

  getMessages = async (threadID: string, pagination?: PaginationArg, limit = 50) => {
    if (!this.currentUser) throw new Error('No current user')
    await this.waitUntilReady()

    const options = {
      before: (pagination?.direction === 'before') ? pagination?.cursor : undefined,
      after: (pagination?.direction === 'after') ? pagination?.cursor : undefined,
    }

    const paginationQuery = options.before ? `before=${options.before}` : options.after ? `after=${options.after}` : ''
    const res = await this.fetch({ method: 'GET', url: `channels/${threadID}/messages?limit=${limit}&${paginationQuery}` })
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
    return [mapMessage(res.json, this.currentUser.id) as Message]
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

    const properties = {
      channel_id: threadID,
      guild_id: null,
      channel_type: 1,
      channel_size_total: 1,
      channel_member_perms: '0',
      channel_hidden: false,
      location_section: 'Channel',
    }
    this.sendScienceRequest(ScienceEventType.ack_messages, properties)
  }

  addReaction = async (threadID: string, messageID: string, reactionKey: string) => {
    await this.waitUntilReady()

    const emoji = this.allCustomEmojis?.find(e => e.displayName === reactionKey)
    // eslint-disable-next-line no-param-reassign
    if (emoji) reactionKey = emoji.reactionKey.slice(2, -1)

    const res = await this.fetch({ method: 'PUT', url: `channels/${threadID}/messages/${messageID}/reactions/${encodeURIComponent(reactionKey)}/@me` })
    if (res.statusCode < 200 || res.statusCode > 204) throw Error(getErrorMessage(res))
  }

  removeReaction = async (threadID: string, messageID: string, reactionKey: string) => {
    await this.waitUntilReady()

    const emoji = this.allCustomEmojis?.find(e => e.displayName === reactionKey)
    // eslint-disable-next-line no-param-reassign
    if (emoji) reactionKey = emoji.reactionKey.slice(2, -1)

    const res = await this.fetch({ method: 'DELETE', url: `channels/${threadID}/messages/${messageID}/reactions/${encodeURIComponent(reactionKey)}/@me` })
    if (res.statusCode < 200 || res.statusCode > 204) throw Error(getErrorMessage(res))
  }

  setTyping = async (type: ActivityType, threadID: string): Promise<void> => {
    if (type === ActivityType.TYPING && this.ready) this.fetch({ method: 'POST', url: `channels/${threadID}/typing` })
  }

  getUsersPresence = async () => {
    await this.waitForInitialData()
    return this.usersPresence
  }

  onGuildCustomEmojiMapUpdate = () => {
    this.allCustomEmojis = Array.from(this.guildCustomEmojiMap?.values()).flat()
  }

  getCustomEmojis = async (): Promise<CustomEmojiMap> => {
    await this.waitForInitialData()
    if (!this.allCustomEmojis) return {}

    const emojis = this.allCustomEmojis.map(e => [e.displayName, e.url])
    return Object.fromEntries(emojis)
  }

  onThreadSelected = async (threadID: string) => {
    this.sendScienceRequest(ScienceEventType.channel_opened, { channel_id: threadID })
  }

  private getUserFriends = async () => {
    const res = await this.fetch({ method: 'GET', url: 'users/@me/relationships' })
    if (res.statusCode < 200 || res.statusCode > 204 || !res.json) throw Error(getErrorMessage(res))
    this.userFriends = res.json
      .filter(f => f.type === 1) // Only friends
      .map(f => mapUser(f.user))

    this.sendScienceRequest(ScienceEventType.dm_list_viewed)
  }

  private mapMentionsAndEmojis = (text: string, mapMentions: boolean = true): string => {
    const mentionRegex = /@([^#@]{3,32}#[0-9]{4})/gi
    const emojiRegex = /:([a-zA-Z0-9-_]*)(~\d*)?:/gi

    return text
      ?.replace(mentionRegex, (match, username) => { // mentions
        if (!mapMentions) return match
        const userID = this.userMappings.get(username)
        if (userID) return `<@!${userID}>`
        return match
      })
      .replace(emojiRegex, match => { // emojis
        const emoji = this.allCustomEmojis?.find(e => `:${e.displayName}:` === match)
        if (emoji) return emoji.reactionKey
        return match
      })
      // TODO: this.emojiShortcuts.shortcuts
      .replace(emojiRegex, (matched, shortcut) => this.emojiShortcuts.emojis.get(shortcut) ?? matched) // emoji shortcuts
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
          this.client.disconnect()
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

  private handleGatewayMessage = (opcode: OPCode, payload: any, type: GatewayMessageType) => {
    texts.log('[discord ws]', opcode, type)

    switch (type) {
      // * Documented

      case GatewayMessageType.HELLO: {
        // handled by WSClient
        break
      }

      case GatewayMessageType.READY: {
        // const notes = payload.notes
        // const user_settings = payload.user_settings

        if (ENABLE_DISCORD_ANALYTICS) this.analyticsToken = payload.analytics_token

        this.userMappings = new Map(payload.users?.map(r => [(r.username + '#' + r.discriminator), r.id]))
        this.readStateMap = new Map(payload.read_state?.entries.map(s => [s.id, s.last_message_id]))
        // presences are in READY_SUPPLEMENTAL if ACT_AS_USER = true

        if (payload.user.premium_type && payload.user.premium_type !== 0) {
          // User has nitro, so store emojis
          const allEmojis = payload.guilds.map(g => {
            const emojis = g.emojis.map(e => ({
              displayName: e.name,
              reactionKey: `<:${e.name}:${e.id}>`,
              url: getEmojiURL(e.id, e.animated),
            }))

            return [g.id, emojis]
          })
          this.guildCustomEmojiMap = new Map<string, DiscordEmoji[]>(allEmojis)

          this.onGuildCustomEmojiMapUpdate()
        }

        if (ENABLE_GUILDS) {
          const mutedChannels = payload.user_guild_settings.entries
            ?.flatMap(g => g.channel_overrides)
            .filter(g => g.muted)
            .map(g => g.channel_id)
          this.mutedChannels = new Set(mutedChannels)

          const allChannels = payload.guilds.map(g => {
            const guildID: string = g.id
            const guildName: string = g.name
            // const guildJoinDate: Date = new Date(guild.joined_at)
            // const guildIconID: string | undefined = guild.icon

            const channels = g.channels.concat(g.threads)
              .filter(c => !IGNORED_CHANNEL_TYPES.has(c.type))
              .map(c => mapChannel(c, this.mutedChannels.has(c.id), guildName))

            return [guildID, channels]
          })
          this.channelsMap = new Map(allChannels)
        }

        this.gotInitialUserData = true
        this.ready = true
        break
      }

      case GatewayMessageType.READY_SUPPLEMENTAL: {
        this.usersPresence = Object.fromEntries(payload.merged_presences.friends?.map(p => [p.user_id, mapPresence(p.user_id, p)]))
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
        if (this.guildCustomEmojiMap) {
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

          this.eventCallback?.([emojiEvent])
        }

        if (!ENABLE_GUILDS) return

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

        this.eventCallback?.(channelEvents)
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

        payload.mentions.forEach(m => this.userMappings.set((m.username + '#' + m.discriminator), m.id))

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
            entries: [mapMessage(payload, this.currentUser.id) as Message],
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

        const presence: UserPresence = mapPresence(payload.user.id, payload)
        this.usersPresence[payload.user.id] = presence

        this.eventCallback?.([{
          type: ServerEventType.USER_PRESENCE_UPDATED,
          presence,
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
    while (!this.gotInitialUserData) await sleep(SLEEP_INTERVAL)
  }

  private waitUntilReady = async () => {
    while (!this.ready) await sleep(SLEEP_INTERVAL)
  }

  private fetch = async ({ url, headers = {}, json, ...rest }: FetchOptions & { url: string, json?: any }): Promise<{ statusCode: number, json?: any }> => {
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

  private sendScienceRequest = (type: ScienceEventType, properties?: any) => {
    if (!ENABLE_DISCORD_ANALYTICS) return

    const event: DiscordScienceEvent = {
      type,
      properties: {
        client_uuid: generateScienceClientUUID(this.currentUser?.id),
        client_send_timestamp: Date.now(),
        client_track_timestamp: Date.now(),
        accessibility_support_enabled: false,
        accessibility_features: 128,
        ...properties,
      },
    }
    const json = {
      events: [event],
      token: this.analyticsToken,
    }

    const headers = {
      'X-Super-Properties': Buffer.from(JSON.stringify(SUPER_PROPERTIES)).toString('base64'),
      'X-Fingerprint': this.deviceFingerprint,
    }

    texts.log(`[discord science] sending ${type}`)
    this.fetch({ method: 'POST', url: 'science', json, headers })
  }
}
