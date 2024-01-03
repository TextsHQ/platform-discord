import path from 'path'
import FormData from 'form-data'
import { promises as fs } from 'fs'
import { uniqBy } from 'lodash'
import { texts, MessageContent, PaginationArg, Thread, Message, ServerEventType, OnServerEventCallback, ActivityType, User, MessageSendOptions, ReAuthError, PresenceMap, Paginated, FetchOptions, ServerEvent, CustomEmojiMap, UserPresence, PaginatedWithCursors } from '@textshq/platform-sdk'
import { ExpectedJSONGotHTMLError } from '@textshq/platform-sdk/dist/json'
import { APIChannel, APIEmoji, APIGuild, APIReaction, APIUser, ChannelType, GatewayPresenceUpdateData, Snowflake } from 'discord-api-types/v9'
import EventEmitter from 'events'

import { mapMessage, mapPresence, mapReaction, mapThread, mapUser } from './mappers/mappers'
import WSClient from './websocket/wsclient'
import { GatewayCloseCode, GatewayMessageType } from './websocket/constants'
import { defaultPacker } from './packers'
import { generateScienceClientUUID, getEmojiURL, sleep } from './util'
import { generateSnowflake } from './common-util'
import { ENABLE_GUILDS, ENABLE_DM_GUILD_MEMBERS, ENABLE_DISCORD_ANALYTICS } from './preferences'
import { IGNORED_CHANNEL_TYPES, ScienceEventType, USER_AGENT } from './constants'
import { SUPER_PROPERTIES } from './discord-constants'
import type { DiscordEmoji, DiscordMessage, DiscordReactionDetails, DiscordScienceEvent } from './types/discord-types'

import _emojis from './resources/emojis.json'
import _emojiShortcuts from './resources/shortcuts.json'
import type { GatewayConnectionOptions, GatewayMessage } from './websocket/types'
import { attachReadyHandlers, attachChannelHandlers, attachGuildHandlers, attachReactionHandlers, attachMessageHandlers, attachRelationshipHandlers, attachRecipientHandlers } from './websocket/event-handlers'

const API_VERSION = 9
const API_ENDPOINT = `https://discord.com/api/v${API_VERSION}`
const DEFAULT_GATEWAY = 'wss://gateway.discord.gg'

const LOG_PREFIX = '[discord]'
const SLEEP_TIME = 100

const WS_OPTIONS: GatewayConnectionOptions = {
  version: API_VERSION,
  encoding: defaultPacker!.encoding,
  // compress: 'zlib-stream'
}

const getErrorMessage = (res: { statusCode: number, json?: any }): string =>
  (res ? (res.json?.message || `Invalid response: ${res.statusCode}`) : 'No response')

export default class DiscordNetworkAPI {
  private client?: WSClient

  private httpClient = texts.createHttpClient!()

  readonly sendMessageNonces = new Set<string>()

  private emojiShortcuts = {
    emojis: new Map<string, string>(_emojis as Iterable<[string, string]>),
    shortcuts: new Map<string, string>(_emojiShortcuts as Iterable<[string, string]>),
  }

  analyticsToken: string | null

  // username-to-id mappings
  usernameIDMap = new Map<string, string>()

  readStateMap = new Map<string, string>()

  channelsMap? = ENABLE_GUILDS ? new Map<string, Thread[]>() : undefined

  // key is guild id
  guildCustomEmojiMap?: Map<string, DiscordEmoji[]>

  private allCustomEmojis?: DiscordEmoji[]

  usersPresence: PresenceMap = {}

  mutedChannels = new Set<string>()

  private lastAckToken?: string = undefined

  private deviceFingerprint?: string = undefined

  gatewayEvents = new EventEmitter({ captureRejections: true })

  token?: string

  accountID?: string

  pendingEventsQueue: ServerEvent[] = []

  eventCallback: OnServerEventCallback = (events: ServerEvent[]) => {
    this.pendingEventsQueue.push(...events)
  }

  startPolling?: () => void

  ready = false

  currentUser?: User

  userFriends: User[] = []

  lastFocusedThread?: string

  constructor() {
    this.gatewayEvents.on('error', error => {
      texts.error(LOG_PREFIX, 'Error occurred in gateway event handler', error)
      texts.Sentry.captureException(error)
    })

    attachReadyHandlers(this)
    attachMessageHandlers(this)
    attachChannelHandlers(this)
    attachGuildHandlers(this)
    attachReactionHandlers(this)
    attachRelationshipHandlers(this)
    attachRecipientHandlers(this)
  }

  login = async (token: string) => {
    texts.log(LOG_PREFIX, 'Logging in with token...')

    if (!token) throw new Error('No token found.')
    this.token = token
    this.connect()

    if (ENABLE_DISCORD_ANALYTICS) {
      const fingerprintRes = await this.fetch({ method: 'POST', url: 'auth/fingerprint' })
      this.deviceFingerprint = fingerprintRes?.json?.fingerprint
    }
  }

  logout = async (provider?: 'gcm', pushToken?: string) => {
    await this.fetch({ method: 'POST', url: 'auth/logout', json: provider ? { provider, token: pushToken } : { provider: null, voip_provider: null } })
    // TODO: Check if disconnecting from WS is needed here
  }

  disconnect = () => {
    texts.log(LOG_PREFIX, 'Disconnecting')
    this.ready = false
    if (this.client?.ready) this.client?.disconnect()
    this.client = undefined
  }

  connect = async (force = false, resume = false) => {
    if (this.client && this.client.ready) {
      if (force) {
        texts.log(LOG_PREFIX, 'Force connect!')
        this.client.disconnect()
      } else {
        texts.log(LOG_PREFIX, 'connect() called, but already has client.')
        return
      }
    }

    texts.log(LOG_PREFIX, 'Connecting...')

    if (!this.client) {
      const url = `${API_ENDPOINT}/gateway`
      const gatewayRes = await this.httpClient.requestAsString(url, { headers: { 'User-Agent': USER_AGENT } })
      const { statusCode, body } = gatewayRes
      if (body[0] === '<') {
        texts.log(statusCode, url, body)
        throw new ExpectedJSONGotHTMLError(statusCode, body)
      }
      const gatewayHost = JSON.parse(gatewayRes?.body)?.url as string ?? DEFAULT_GATEWAY
      this.client = new WSClient(gatewayHost, this.token!, defaultPacker!, WS_OPTIONS)
    }

    // this.client.resumeOnConnect = resume
    await this.client.connect()
    this.setupGatewayListeners()
  }

  getMe = async () => {
    const res = await this.fetch({ method: 'GET', url: 'users/@me', checkError: true })
    return res
  }

  getThreads = async (folderName: string, pagination?: PaginationArg): Promise<PaginatedWithCursors<Thread>> => {
    await this.waitUntilReady()

    const res = await this.fetch({ method: 'GET', url: 'users/@me/channels', checkError: true })

    const threads: Thread[] = (res!.json as APIChannel[])
      // @ts-expect-error We're not checking categories
      .sort((a, b) => +a.last_message_id! - +b.last_message_id!)
      .reverse()
      .map(t => mapThread(t, this.readStateMap.get(t.id), this.mutedChannels.has(t.id), this.currentUser))

    threads.flatMap(t => t.participants.items).forEach(p => this.usernameIDMap.set(p.username!, p.id))

    // TODO: App doesn't display empty channels
    const items = ENABLE_GUILDS ? threads.concat([...this.channelsMap?.values() ?? []].flat()) : threads

    // TODO: Verify that the order is correct, so we give Texts the right
    // cursor.
    return { items, hasMore: false, oldestCursor: threads[threads.length - 1].id }
  }

  createThread = async (userIDs: string[], title?: string): Promise<boolean | Thread> => {
    if (userIDs.length === 1 && userIDs[0] === this.currentUser?.id) return false
    await this.waitUntilReady()

    const res = await this.fetch({
      method: 'POST',
      url: 'users/@me/channels',
      json: userIDs.length === 1 ? { recipient_id: userIDs[0] } : { recipients: userIDs },
      checkError: true,
    })
    const json = res!.json

    return mapThread(json, undefined, this.mutedChannels.has(json.id), this.currentUser)
  }

  /** https://discord.com/developers/docs/resources/channel#deleteclose-channel */
  closeThread = async (threadID: string) => {
    await this.fetch({ method: 'DELETE', url: `channels/${threadID}` })
  }

  // private blockUser = async (userID: string) => {
  //   const res = await this.fetch({
  //     method: 'PUT',
  //     url: `users/@me/relationships/${userID}`,
  //     json: { type: 2 },
  //   })
  //   return res?.statusCode === 204
  // }

  reportThread = async (threadID: string, _messageID?: string) => {
    /*
      This WILL fail if it's not really `first_dm`:
      { message: "Report Type 'first_dm' is currently unsupported", code: 0 } (400)

      TODO: Find other types
    */

    // TODO: Review - this getMessages call is untested
    const messageID = _messageID || await this.getMessages(threadID, { direction: 'after', cursor: '0' }).then(m => m?.[0]?.id)

    const referer = 'https://discord.com/message-requests'

    // I don't think it's really needed, and it's slowing down the flow :/
    // const res1 = await this.fetch({
    //   url: "reporting/menu/first_dm",
    //   method: "GET",
    //   headers: {
    //     referer
    //   }
    // })
    // const { root_node_id } = res1.json

    const json2 = {
      version: '1.0', // don't know
      variant: '1', // don't know
      language: 'en', // client (message?) lang?
      breadcrumbs: [ // UX flow breadcrumbs?
        32, // root_node_id   // possibly? maybe? not sure
      ],
      elements: {}, // don't know
      name: 'first_dm', // report type?
      channel_id: threadID,
      message_id: messageID,
    }
    const res2 = await this.fetch({
      url: 'reporting/first_dm',
      method: 'POST',
      headers: {
        referer,
      },
      json: json2,
    })

    // texts.log(`${LOG_PREFIX} reported thread`, res1?.statusCode, res1?.json, res2?.statusCode, res2?.json)
    texts.log(`${LOG_PREFIX} reported thread`, res2?.statusCode, res2?.json)
    const success = !!res2.json.report_id

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
          text: `Something went wrong while reporting thread: ${res2?.json.message}`,
        },
      }])
    }
    return success
  }

  createDevice = async (token: string) => {
    await this.waitUntilReady()

    await this.fetch({
      method: 'POST',
      url: 'users/@me/devices',
      json: {
        provider: 'gcm',
        token,
      },
      checkError: true,
    })
  }

  getMessageReactions = async (message: DiscordMessage, threadID: string) => {
    const getReactionDetails = async (r: APIReaction): Promise<DiscordReactionDetails | undefined> => {
      const emojiQuery = r.emoji.id ? `${r.emoji.name}:${r.emoji.id}` : r.emoji.name
      if (!emojiQuery) return
      const query = encodeURIComponent(emojiQuery)
      const reactedRes = await this.fetch({ method: 'GET', url: `channels/${threadID}/messages/${message.id}/reactions/${query}` })
      const users: APIUser[] = reactedRes?.json
      return users ? { emoji: r.emoji, users } : undefined
    }
    const reactionsDetails = await Promise.all(message.reactions?.map(getReactionDetails) ?? [])
    const mapped = mapMessage(message, this.currentUser?.id, reactionsDetails)
    if (mapped?.text) mapped.text = this.mapMentionsAndEmojis(mapped.text, false)
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
    const res = await this.fetch({ method: 'GET', url: `channels/${threadID}/messages?limit=${limit}&${paginationQuery}`, checkError: true })

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
        type: ServerEventType.STATE_SYNC,
        mutationType: 'upsert',
        objectName: 'participant',
        objectIDs: { threadID },
        entries,
      }]
      this.eventCallback(authorEvents)
    }

    return messages.sort((a, b) => (a!.timestamp?.getTime() ?? 0) - (b!.timestamp?.getTime() ?? 0))
  }

  sendMessage = async (threadID: string, content: MessageContent, options?: MessageSendOptions) => {
    const text = content.text ? this.mapMentionsAndEmojis(content.text) : undefined

    type RequestContent = {
      headers: { [key: string]: string }
      message_reference: { [key: string]: string | undefined } | undefined
      json: any | undefined
      body: any | undefined
    }
    const requestContent: RequestContent = {
      headers: {},
      message_reference: undefined,
      json: undefined,
      body: undefined,
    }

    if (options?.quotedMessageID) requestContent.message_reference = { message_id: options?.quotedMessageID }

    const nonce = options?.pendingMessageID?.includes('-')
      ? generateSnowflake().toString() // for ios
      : options?.pendingMessageID
    this.sendMessageNonces.add(nonce!)

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
      checkError: true,
    })

    return [mapMessage(res!.json, this.currentUser?.id) as Message]
  }

  editMessage = async (threadID: string, messageID: string, content: MessageContent, options?: MessageSendOptions): Promise<boolean> => {
    await this.waitUntilReady()

    const text = content.text ? this.mapMentionsAndEmojis(content.text) : ''

    await this.fetch({ url: `channels/${threadID}/messages/${messageID}`, method: 'PATCH', json: { content: text }, checkError: true })
    return true
  }

  searchMessages = async (typed: string, threadID: string, pagination?: PaginationArg): Promise<Paginated<Message>> => {
    await this.waitUntilReady()

    const res = await this.fetch({ url: `channels/${threadID}/messages/search?content=${encodeURIComponent(typed)}`, method: 'GET', checkError: true })
    const messages: Message[] = res!.json?.messages
    return { items: messages, hasMore: false }
  }

  patchChannel = async (channelID: string, patches: { name?: string, icon?: string }) => {
    await this.fetch({ url: `channels/${channelID}`, method: 'PATCH', json: patches, checkError: true })
  }

  patchSettings = async (threadID: string, overrides: any) => {
    const json = { channel_overrides: { [threadID]: overrides } }
    await this.fetch({ url: 'users/@me/guilds/@me/settings', method: 'PATCH', json, checkError: true })
  }

  muteThread = async (threadID: string, mutedUntil: Date | 'forever' | undefined) => {
    const settings = mutedUntil === 'forever' ? {
      muted: true,
      mute_config: {
        selected_time_window: -1,
        end_time: null,
      },
    } : { muted: false }
    return this.patchSettings(threadID, settings)
  }

  deleteMessage = async (threadID: string, messageID: string, forEveryone?: boolean) => {
    if (!forEveryone) return
    await this.waitUntilReady()

    await this.fetch({ method: 'DELETE', url: `channels/${threadID}/messages/${messageID}`, checkError: true })
  }

  sendReadReceipt = async (threadID: string, messageID: string) => {
    await this.waitUntilReady()

    const res = await this.fetch({ method: 'POST', url: `channels/${threadID}/messages/${messageID}/ack`, json: { token: this.lastAckToken }, checkError: true })
    this.lastAckToken = res!.json?.token

    this.readStateMap.set(threadID, messageID!)

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
    if (emoji) reactionKey = emoji.reactionKey.slice(2, -1)

    await this.fetch({ method: 'PUT', url: `channels/${threadID}/messages/${messageID}/reactions/${encodeURIComponent(reactionKey)}/@me`, checkError: true })
  }

  removeReaction = async (threadID: string, messageID: string, reactionKey: string) => {
    await this.waitUntilReady()

    const emoji = this.allCustomEmojis?.find(e => e.displayName === reactionKey)
    if (emoji) reactionKey = emoji.reactionKey.slice(2, -1)

    await this.fetch({ method: 'DELETE', url: `channels/${threadID}/messages/${messageID}/reactions/${encodeURIComponent(reactionKey)}/@me`, checkError: true })
  }

  setTyping = async (type: ActivityType, threadID?: string): Promise<void> => {
    if (type === ActivityType.TYPING && this.ready && threadID) await this.fetch({ method: 'POST', url: `channels/${threadID}/typing` })
  }

  modifyParticipant = async (threadID: string, participantID: string, remove = false) => {
    await this.waitUntilReady()

    const method = remove ? 'DELETE' : 'PUT'
    await this.fetch({ method, url: `channels/${threadID}/recipients/${participantID}`, checkError: true })
  }

  getUsersPresence = async () => {
    await this.waitUntilReady()
    return this.usersPresence
  }

  getCustomEmojis = async (): Promise<CustomEmojiMap> => {
    await this.waitUntilReady()
    if (!this.allCustomEmojis) return {}

    const emojis = this.allCustomEmojis.map(e => [e.displayName, e.url])
    return Object.fromEntries(emojis)
  }

  onThreadSelected = async (threadID?: string) => {
    this.lastFocusedThread = threadID
    await this.sendScienceRequest(ScienceEventType.channel_opened, { channel_id: threadID })
  }

  setGatewayShouldResume = (shouldResume: boolean) => {
    if (this.client) this.client.shouldResume = shouldResume
  }

  onGuildCustomEmojiMapUpdate = () => {
    if (this.guildCustomEmojiMap) this.allCustomEmojis = Array.from(this.guildCustomEmojiMap.values()).flat()
    // TODO: State sync
  }

  getUserFriends = async () => {
    const res = await this.fetch({ method: 'GET', url: 'users/@me/relationships', checkError: true })
    this.userFriends = (res!.json as { type: number, user: APIUser }[])
      ?.filter(f => f.type === 1) // Only friends
      .map(f => mapUser(f.user))

    this.sendScienceRequest(ScienceEventType.dm_list_viewed)
  }

  private mapMentionsAndEmojis = (text: string, mapMentions = true): string => {
    const mentionRegex = /@([^#@]{3,32}#[0-9]{4})/gi
    const emojiRegex = /:([a-zA-Z0-9-_]*)(~\d*)?:/gi

    // TODO: Check if user has swapping emojis enabled
    // TODO: Fix mappings for users without discriminators
    return text
      ?.replace(mentionRegex, (match, username) => { // mentions
        if (!mapMentions) return match
        const userID = this.usernameIDMap.get(username)
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
    if (!this.client) throw new Error('Client not initialized!')

    this.client.onChangedReadyState = ready => {
      texts.log(`${LOG_PREFIX} Client connection state: ${ready}`)
      this.ready = ready
    }

    this.client.onConnectionClosed = (code, reason) => {
      this.ready = false

      // TODO: Show toast

      switch (code) {
        case GatewayCloseCode.ADDRESS_NOT_FOUND:
          texts.log(LOG_PREFIX, 'Gateway connection closed due to network connection loss.')
          this.startPolling?.()
          break
        case GatewayCloseCode.AUTHENTICATION_FAILED:
          texts.log(LOG_PREFIX, 'Gateway connection closed due to authentication failure.')
          this.client?.disconnect()
          this.client = undefined
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw new ReAuthError('Access token invalid')
        case GatewayCloseCode.SESSION_TIMED_OUT:
          texts.log(`${LOG_PREFIX} Gateway session timed out`)
          break
        default:
          break
      }
    }

    this.client.onError = error => {
      texts.Sentry.captureException(error)
    }

    this.client.gatewayMessageHandler = this.handleGatewayMessage
  }

  private handleGatewayMessage = (message: GatewayMessage) => {
    // texts.log(LOG_PREFIX, op, d, t)
    this.gatewayEvents.emit('message', message)
    if (message.t) {
      this.gatewayEvents.emit(message.t, message)
    }
  }

  private waitUntilReady = async () => {
    while (!this.ready) await sleep(SLEEP_TIME)
  }

  private fetch = async ({ url, headers = {}, json, checkError, ...rest }: FetchOptions & { url: string, json?: any, checkError?: boolean }): Promise<{ statusCode: number, json?: any } | undefined> => {
    try {
      const opts: FetchOptions = {
        // TODO: timeout: 10000,
        ...rest,
        body: json ? JSON.stringify(json) : rest.body,
        headers: {
          'User-Agent': USER_AGENT,
          Authorization: this.token!,
          // TODO: x-super-proporties?
          ...headers,
        },
      }
      if (json) opts.headers!['Content-Type'] = 'application/json'

      const res = await this.httpClient.requestAsString(`${API_ENDPOINT}/${url}`, opts)
      const { statusCode, body } = res
      if (statusCode === 401) throw new ReAuthError('Unauthorized')
      const hasBody = body?.length
      if (hasBody && body[0] === '<') {
        texts.log(statusCode, url, body)
        throw new ExpectedJSONGotHTMLError(statusCode, body)
      }
      const responseJSON = hasBody ? JSON.parse(body) : undefined
      if (checkError && (statusCode < 200 || statusCode > 204 || (statusCode !== 204 && !responseJSON))) throw new Error(getErrorMessage(res))
      return {
        statusCode,
        json: responseJSON,
      }
    } catch (err: any) {
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

  private sendScienceRequest = async (type: ScienceEventType, properties?: any) => {
    if (!ENABLE_DISCORD_ANALYTICS || !this.deviceFingerprint) return

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
    await this.fetch({ method: 'POST', url: 'science', json, headers })
  }
}
