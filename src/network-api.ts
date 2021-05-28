import fs from 'fs'
import FormData from 'form-data'
import { texts, CurrentUser, MessageContent, PaginationArg, Thread, Message, ServerEventType, OnServerEventCallback, ActivityType, User, InboxName, MessageSendOptions, ReAuthError, PresenceMap, Paginated, FetchOptions, ServerEvent } from '@textshq/platform-sdk'

import { mapChannel, mapCurrentUser, mapMessage, mapThread, mapUser } from './mappers'
import WSClient from './websocket/wsclient'
import { GatewayCloseCode, GatewayMessageType } from './websocket/constants'
import { defaultPacker } from './packers'
import { IGNORED_CHANNEL_TYPES } from './constants'
import { sleep } from './util'

const API_ENDPOINT = 'https://discord.com/api/v9'
const WAIT_TILL_READY = true
const RESTART_ON_FAIL = true
const ACT_AS_USER = true
const ENABLE_GUILDS = true

export default class DiscordNetworkAPI {
  private client?: WSClient

  // ID-to-username mappings
  private userMappings: Map<string, string> = new Map()

  private readStateMap: Map<string, string> = new Map()

  private channelsMap?: Map<string, Thread[]>

  private mutedChannels: string[] = []

  private usersPresence: PresenceMap = {}

  private gotInitialUserData = false

  token?: string

  eventCallback?: OnServerEventCallback

  startPolling?: () => void

  stopPolling?: () => void

  ready = false

  currentUser?: CurrentUser

  userFriends: User[] = []

  constructor() {
    if (ENABLE_GUILDS) {
      this.channelsMap = new Map()
    }
  }

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
    const gatewayRes = await texts.fetch(`${API_ENDPOINT}/gateway`, { headers: { 'User-Agent': texts.constants.USER_AGENT } })
    const gatewayHost = JSON.parse(gatewayRes?.body.toString('utf-8'))?.url as string ?? 'wss://gateway.discord.gg'
    const gatewayFullURL = `${gatewayHost}/?v=9&encoding=${defaultPacker.encoding}`

    this.client = new WSClient(gatewayFullURL, this.token, ACT_AS_USER, defaultPacker)
    texts.log('[DISCORD GATEWAY] URL:', gatewayFullURL)
    this.client.restartOnFail = RESTART_ON_FAIL

    this.setupGatewayListeners()
  }

  getCurrentUser = async (): Promise<CurrentUser> => {
    const res = await this.fetch({ method: 'GET', url: 'users/@me' })
    if (!res?.json) throw new Error('No response')

    const currentUser = mapCurrentUser(res?.json)
    this.currentUser = currentUser
    if (currentUser.id && currentUser.displayText) this.userMappings.set(currentUser.id, currentUser.displayText)

    this.getUserFriends()

    return currentUser
  }

  getThreads = async (inboxName: InboxName, pagination?: PaginationArg): Promise<Paginated<Thread>> => {
    await this.waitForInitialData()
    const res = await this.fetch({ method: 'GET', url: 'users/@me/channels' })
    if (!res?.json) throw new Error('No response')

    const threads: Thread[] = await Promise.all(res?.json
      .sort((a, b) => a.last_message_id - b.last_message_id)
      .reverse()
      .map(thread => mapThread(thread, this.readStateMap.get(thread.id), this.currentUser)))

    // TODO: App doesn't display empty (unloaded) channels
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

    if (!res?.json) throw new Error('No response')
    return mapThread(res?.json, null, this.currentUser, this.userMappings)
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
        const parsed = reactedRes?.json
        if (parsed) return { emoji: r.emoji, users: parsed }
        return null
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
    if (!res?.json) throw new Error('No response')

    const objects: { message: Message, author: User }[] = await Promise.all(res?.json.map(async m => ({ message: await this.getMessage(m, threadID), author: mapUser(m.author) })))

    const authorEvents: ServerEvent[] = objects.map(o => o.author).map(a => ({
      type: ServerEventType.STATE_SYNC,
      mutationType: 'upsert',
      objectName: 'participant',
      objectIDs: { threadID },
      entries: [a],
    }))
    this.eventCallback?.(authorEvents)

    return objects.map(o => o.message).filter(Boolean).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }

  sendMessage = async (threadID: string, content: MessageContent, options?: MessageSendOptions): Promise<boolean> => {
    await this.waitUntilReady()

    const text = this.mapMentions(content.text)

    const requestContent = {
      headers: {},
      message_reference: undefined,
      json: undefined,
      body: undefined,
    }

    if (options?.quotedMessageID) {
      requestContent.message_reference = { message_id: options?.quotedMessageID }
    }

    if (content.fileBuffer || content.filePath) {
      const form = new FormData()
      if (content.fileBuffer) {
        form.append('file', content.fileBuffer, {
          filename: content.fileName,
          knownLength: content.fileBuffer?.length,
        })
      } else if (content.filePath) {
        form.append('file', fs.createReadStream(content.filePath))
      }

      const payload_json = {
        content: text || '',
        tts: false,
        message_reference: requestContent.message_reference,
      }
      form.append('payload_json', JSON.stringify(payload_json))

      requestContent.headers = form.getHeaders()
      requestContent.body = form
    } else {
      requestContent.headers = { 'Content-Type': 'application/json' }
      requestContent.json = {
        content: text,
        tts: false,
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

    if (res?.statusCode !== 200) throw Error(res?.json?.message || `invalid response: ${res?.statusCode}`)

    return true
  }

  editMessage = async (threadID: string, messageID: string, content: MessageContent, options?: MessageSendOptions): Promise<boolean> => {
    await this.waitUntilReady()

    const text = this.mapMentions(content.text)

    const res = await this.fetch({ url: `channels/${threadID}/messages/${messageID}`, method: 'PATCH', json: { content: text } })
    return res?.statusCode === 200
  }

  patchChannel = async (channelID: string, patches: { name?: string, icon?: string }) => {
    const res = await this.fetch({ url: `channels/${channelID}`, method: 'PATCH', json: patches })
    return res?.statusCode === 200
  }

  deleteMessage = async (threadID: string, messageID: string, forEveryone?: boolean): Promise<boolean> => {
    if (!forEveryone) return false
    await this.waitUntilReady()
    const res = await this.fetch({ method: 'DELETE', url: `channels/${threadID}/messages/${messageID}` })
    return res?.statusCode === 204
  }

  sendReadReceipt = async (threadID: string, messageID: string) => {
    await this.waitUntilReady()
    // TODO: Get token
    const res = await this.fetch({ method: 'POST', url: `channels/${threadID}/messages/${messageID}/ack`, json: { token: null } })
    if (res?.statusCode === 204) this.readStateMap.set(threadID, messageID)
  }

  addReaction = async (threadID: string, messageID: string, reactionKey: string): Promise<boolean> => {
    await this.waitUntilReady()

    const res = await this.fetch({ method: 'PUT', url: `channels/${threadID}/messages/${messageID}/reactions/${encodeURIComponent(reactionKey)}/@me` })
    return res?.statusCode === 204
  }

  removeReaction = async (threadID: string, messageID: string, reactionKey: string): Promise<boolean> => {
    await this.waitUntilReady()

    const res = await this.fetch({ method: 'DELETE', url: `channels/${threadID}/messages/${messageID}/reactions/${encodeURIComponent(reactionKey)}/@me` })
    return res?.statusCode === 204
  }

  setTyping = async (type: ActivityType, threadID: string): Promise<void> => {
    if (type === ActivityType.TYPING && this.ready) this.fetch({ method: 'POST', url: `channels/${threadID}/typing` })
  }

  getUsersPresence = async () => {
    await this.waitForInitialData()
    return this.usersPresence
  }

  private getUserFriends = async () => {
    const res = await this.fetch({ method: 'GET', url: 'users/@me/relationships' })
    if (!res?.json) throw new Error('No response')
    this.userFriends = res?.json.filter(f => f.type === 1) // Only friends
      .map(f => mapUser(f.user))
  }

  private setupGatewayListeners = () => {
    if (!this.client) throw new Error('WSClient not initialized!')

    this.client.onChangedReadyState = ready => {
      texts.log('[DISCORD GATEWAY] Connection state: ' + ready)
      this.ready = ready
    }

    this.client.onConnectionClosed = (code, reason) => {
      texts.log('[DISCORD GATEWAY] Connection to websocket closed with code', code + '. Reason:', reason)
      this.ready = false

      switch (code) {
        case GatewayCloseCode.ADDRESS_NOT_FOUND:
          this.startPolling?.()
          break
        case GatewayCloseCode.RECONNECT_REQUESTED:
          texts.log('[DISCORD GATEWAY] Gateway requested client reconnect.')
          break
        case GatewayCloseCode.AUTHENTICATION_FAILED:
          this.client = null
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw new ReAuthError('Access token invalid')
        case GatewayCloseCode.SESSION_TIMED_OUT:
          texts.log('[DISCORD GATEWAY] Gateway session timed out.')
          break
        default:
          break
      }
    }

    this.client.onError = error => {
      throw error
    }

    this.client.onMessage = this.handleGatewayMessage
  }

  private handleGatewayMessage = (opcode, payload, type) => {
    texts.log('[DISCORD GATEWAY]', opcode, type)

    switch (type) {
      // * Documented
      case GatewayMessageType.HELLO:
        // handled by WSClient
        break

      case GatewayMessageType.READY: {
        // const notes = payload.notes
        // const user_settings = payload.user_settings

        if (ACT_AS_USER) {
          payload.relationships?.filter(Boolean).forEach(r => this.userMappings.set(r.id, (r.username + '#' + r.discriminator)))
          payload.read_state?.entries?.forEach(p => this.readStateMap.set(p.id, p.last_message_id))
          // apparently there's no presences when acting as a user
        } else {
          payload.relationships?.filter(Boolean).forEach(r => this.userMappings.set(r.id, (r.user.username + '#' + r.user.discriminator)))
          payload.read_state?.forEach(p => this.readStateMap.set(p.id, p.last_message_id))
          payload.presences?.forEach(p => {
            this.usersPresence[p.user.id] = { userID: p.user.id, isActive: p.status === 'online', lastActive: new Date(+p.last_modified) }
          })
        }

        if (ENABLE_GUILDS) {
          this.mutedChannels = payload.user_guild_settings.entries?.flatMap(g => g.channel_overrides).filter(g => g.muted).map(g => g.channel_id)

          payload.guilds.forEach(guild => {
            const guildID: string = guild.id
            const guildName: string = guild.name
            // const guildJoinDate: Date = new Date(guild.joined_at)
            // const guildIconID: string | undefined = guild.icon

            const channels = guild.channels
              .filter(c => !IGNORED_CHANNEL_TYPES.includes(c.type))
              .map(c => mapChannel(c, this.mutedChannels.includes(c.id), guildName))

            this.channelsMap.set(guildID, channels)
          })
        }

        this.gotInitialUserData = true
        this.ready = true
        break
      }

      case GatewayMessageType.RESUMED:
        // TODO: RESUMED

        console.log(payload)
        break

      case GatewayMessageType.RECONNECT:
        // TODO: RECONNECT

        console.log(payload)
        break

      case GatewayMessageType.INVALID_SESSION:
        // TODO: INVALID_SESSION

        console.log(payload)
        break

      case GatewayMessageType.APPLICATION_COMMAND_CREATE: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.APPLICATION_COMMAND_UPDATE: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.APPLICATION_COMMAND_DELETE: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.CHANNEL_CREATE: {
        if (!ENABLE_GUILDS && payload.guild_id) return

        const channel = mapChannel(payload, this.mutedChannels.includes(payload.id))
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
        const newChannel = mapChannel(payload, this.mutedChannels.includes(payload.id))
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
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.THREAD_CREATE: {
        // TODO: THREAD_CREATE

        console.log(payload)
        break
      }

      case GatewayMessageType.THREAD_UPDATE: {
        // TODO: THREAD_UPDATE

        console.log(payload)
        break
      }

      case GatewayMessageType.THREAD_DELETE: {
        // TODO: THREAD_DELETE

        console.log(payload)
        break
      }

      case GatewayMessageType.THREAD_LIST_SYNC: {
        // TODO: THREAD_LIST_SYNC

        console.log(payload)
        break
      }

      case GatewayMessageType.THREAD_MEMBER_UPDATE: {
        // TODO: THREAD_MEMBER_UPDATE

        console.log(payload)
        break
      }

      case GatewayMessageType.THREAD_MEMBERS_UPDATE: {
        // TODO: THREAD_MEMBERS_UPDATE

        console.log(payload)
        break
      }

      case GatewayMessageType.GUILD_CREATE: {
        if (!ENABLE_GUILDS) return

        const guildID: string = payload.id
        const guildName: string = payload.name
        // const guildJoinDate: Date = new Date(payload.joined_at)
        // const guildIconID: string | undefined = payload.icon

        const channels = payload.channels
          .filter(c => !IGNORED_CHANNEL_TYPES.includes(c.type))
          .map(c => mapChannel(c, this.mutedChannels.includes(c.id)), guildName)

        this.channelsMap?.set(guildID, channels)

        const events: ServerEvent[] = channels.map(c => ({
          type: ServerEventType.STATE_SYNC,
          mutationType: 'upsert',
          objectName: 'thread',
          objectIDs: {
            threadID: c.id,
          },
          entries: [c],
        }))
        this.eventCallback?.(events)

        break
      }

      case GatewayMessageType.GUILD_UPDATE: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.GUILD_DELETE: {
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

      case GatewayMessageType.GUILD_BAN_ADD: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.GUILD_BAN_REMOVE: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.GUILD_EMOJIS_UPDATE: {
        // TODO: GUILD_EMOJIS_UPDATE
        break
      }

      case GatewayMessageType.GUILD_INTEGRATIONS_UPDATE: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.GUILD_MEMBER_ADD: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.GUILD_MEMBER_REMOVE: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.GUILD_MEMBER_UPDATE: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.GUILD_MEMBERS_CHUNK: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.GUILD_ROLE_CREATE: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.GUILD_ROLE_UPDATE: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.GUILD_ROLE_DELETE: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.INTEGRATION_CREATE: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.INTEGRATION_UPDATE: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.INTEGRATION_DELETE: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.INTERACTION_CREATE: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.INVITE_CREATE: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.INVITE_DELETE: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.MESSAGE_CREATE: {
        if (!ENABLE_GUILDS && payload.guild_id) return

        // kinda broken with ACT_AS_USER = false
        payload.mentions.filter(Boolean).forEach(m => this.userMappings.set(m.id, (m.username + '#' + m.discriminator)))

        if (payload.author) {
          // upsert sender
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

        // upsert message
        const message = mapMessage(payload, this.currentUser?.id)
        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'upsert',
          objectName: 'message',
          objectIDs: {
            threadID: payload.channel_id,
            messageID: payload.id,
          },
          entries: [message],
        }])

        break
      }

      case GatewayMessageType.MESSAGE_UPDATE: {
        if (!ENABLE_GUILDS && payload.guild_id) return

        const message = mapMessage(payload, this.currentUser?.id)
        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'update',
          objectName: 'message',
          objectIDs: {
            threadID: payload.channel_id,
            messageID: payload.id,
          },
          entries: [message],
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

        const reaction = {
          id: payload.emoji.id,
          reactionKey: payload.emoji.name,
          participantID: payload.user_id,
          emoji: true,
        }
        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'update',
          objectName: 'message',
          objectIDs: {
            threadID: payload.channel_id,
            messageID: payload.message_id,
          },
          entries: [{ reactions: [reaction] }],
        }])
        break
      }

      case GatewayMessageType.MESSAGE_REACTION_REMOVE: {
        if (!ENABLE_GUILDS && payload.guild_id) return

        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'update',
          objectName: 'message',
          objectIDs: {
            threadID: payload.channel_id,
            messageID: payload.message_id,
          },
          entries: [{ reactions: [] }],
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
            messageID: payload.message_id,
          },
          entries: [{ reactions: [] }],
        }])
        break
      }

      case GatewayMessageType.MESSAGE_REACTION_REMOVE_EMOJI: {
        if (!ENABLE_GUILDS && payload.guild_id) return

        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'update',
          objectName: 'message',
          objectIDs: {
            threadID: payload.channel_id,
            messageID: payload.message_id,
          },
          entries: [{ reactions: [] }],
        }])
        break
      }

      case GatewayMessageType.PRESENCE_UPDATE: {
        // we don't care about guild updates
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

        this.eventCallback?.([{ type: ServerEventType.PARTICIPANT_TYPING, typing: true, participantID: payload.user_id, threadID: payload.channel_id }])
        break
      }

      case GatewayMessageType.USER_UPDATE:
        // TODO: USER_UPDATE

        console.log(payload)
        break

      case GatewayMessageType.VOICE_STATE_UPDATE: {
        // we're ignoring voice states
        break
      }

      case GatewayMessageType.VOICE_SERVER_UPDATE: {
        // we're ignoring voice states
        break
      }

      case GatewayMessageType.WEBHOOKS_UPDATE: {
        // this doesn't do anything we should care about
        break
      }

      // * Undocumented
      case GatewayMessageType.CHANNEL_PINS_ACK: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.CHANNEL_UNREAD_UPDATE: {
        // TODO: CHANNEL_UNREAD_UPDATE

        console.log(payload)
        break
      }

      case GatewayMessageType.MESSAGE_ACK: {
        if (!ENABLE_GUILDS && payload.guild_id) return

        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'update',
          objectName: 'thread',
          objectIDs: {
            threadID: payload.channel_id,
          },
          entries: [{ isUnread: false }],
        }])
        break
      }

      case GatewayMessageType.READY_SUPPLEMENTAL: {
        // i have no idea what to do with this data
        break
      }

      case GatewayMessageType.RELATIONSHIP_ADD: {
        const user = mapUser(payload.user)
        if (!this.userFriends.includes(user)) {
          this.userFriends.push(user)
        }

        break
      }

      case GatewayMessageType.RELATIONSHIP_REMOVE: {
        const index = this.userFriends.findIndex(f => f.id === payload.id)
        if (index > 0) {
          this.userFriends.splice(index, 1)
        }

        break
      }

      case GatewayMessageType.SESSIONS_REPLACE: {
        // this doesn't do anything we should care about
        break
      }

      // * Defaults
      case null: {
        break
      }

      default: {
        texts.log('[DISCORD GATEWAY] Unhandled', opcode, type, payload)
        break
      }
    }
  }

  private mapMentions = (text: string) => {
    // TODO: Test guilds
    // @ts-expect-error replaceAll
    return text?.replaceAll(/@([^#@]{3,32}#[0-9]{4})/gi, (_, username) => {
      const user = Array.from(this.userMappings).find(u => u[1] === username)
      if (user) return `<@!${user[0]}>`
      return username
    })
  }

  private waitForInitialData = async () => {
    while (!this.gotInitialUserData) await sleep(100)
  }

  private waitUntilReady = async () => {
    while (!this.ready && WAIT_TILL_READY) await sleep(100)
  }

  private handleErrors = (json: any, statusCode: number) => {
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    if (statusCode === 401) throw new ReAuthError('Unauthorized')
    if (json.message && json.code) texts.error(json)
  }

  private fetch = async ({ url, headers = {}, json, ...rest }: FetchOptions & { url: string, json?: any }) => {
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

      if (json) {
        opts.headers['Content-Type'] = 'application/json'
      }

      const res = await texts.fetch(`${API_ENDPOINT}/${url}`, opts)

      const responseJSON = res.body.length ? JSON.parse(res.body.toString('utf-8')) : undefined
      if (res.body) {
        if (responseJSON) this.handleErrors(responseJSON, res.statusCode)
      }
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
