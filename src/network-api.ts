import fs from 'fs'
import FormData from 'form-data'
import { texts, CurrentUser, MessageContent, PaginationArg, Thread, Message, ServerEventType, OnServerEventCallback, ActivityType, User, InboxName, MessageSendOptions, ReAuthError, PresenceMap, Paginated, FetchOptions, ServerEvent } from '@textshq/platform-sdk'

import { mapChannel, mapCurrentUser, mapMessage, mapThread, mapUser } from './mappers'
import WSClient from './websocket/wsclient'
import { GatewayCloseCode, GatewayMessageType } from './websocket/constants'
import { defaultPacker } from './packers'
import { IGNORED_CHANNEL_TYPES } from './constants'

const API_ENDPOINT = 'https://discord.com/api/v9'
const WAIT_TILL_READY = true
const RESTART_ON_FAIL = true
const ACT_AS_USER = true
const ENABLE_GUILDS = true

async function sleep(time: number) {
  return new Promise(resolve => setTimeout(resolve, time))
}

export default class DiscordNetworkAPI {
  private client?: WSClient

  // ID-to-username mappings
  private userMappings: Map<string, string> = new Map()

  private readStateMap: Map<string, string> = new Map()

  private channelsMap?: Map<string, Thread[]>

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
    this.userMappings.set(currentUser.id, currentUser.displayText)

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
    return mapThread(res?.json, '', this.currentUser)
  }

  /** https://discord.com/developers/docs/resources/channel#deleteclose-channel */
  archiveThread = async (threadID: string) => {
    await this.fetch({ method: 'DELETE', url: `channels/${threadID}` })
  }

  getMessages = async (threadID: string, pagination?: PaginationArg): Promise<Message[]> => {
    if (!this.currentUser) throw new Error('No current user')
    const currentUser = this.currentUser

    await this.waitUntilReady()

    const options = {
      before: (pagination?.direction === 'before') ? pagination?.cursor : undefined,
      after: (pagination?.direction === 'after') ? pagination?.cursor : undefined,
    }

    const paginationQuery = options.before ? `before=${options.before}` : options.after ? `after=${options.after}` : ''
    const res = await this.fetch({ method: 'GET', url: `channels/${threadID}/messages?limit=50&${paginationQuery}` })
    if (!res?.json) throw new Error('No response')

    const objects: { message: Message, author: User }[] = await Promise.all(res?.json
      .map(async m => {
        let reactionsDetails
        if (m.reactions) {
          reactionsDetails = await Promise.all(m.reactions.map(async r => {
            const emojiQuery = encodeURIComponent(r.emoji.id ? `${r.emoji.name}:${r.emoji.id}` : r.emoji.name)
            const reactedRes = await this.fetch({ method: 'GET', url: `channels/${threadID}/messages/${m.id}/reactions/${emojiQuery}` })
            const parsed = reactedRes?.json
            if (parsed) return { emoji: r.emoji, users: parsed }
            return null
          }))
        }

        return { message: mapMessage(m, currentUser.id, reactionsDetails, this.userMappings), author: mapUser(m.author) }
      }))

    const authorEvents: ServerEvent[] = objects.map(o => o.author).map(a => ({
      type: ServerEventType.STATE_SYNC,
      mutationType: 'upsert',
      objectName: 'participant',
      objectIDs: { threadID },
      entries: [a],
    }))
    this.eventCallback?.(authorEvents)

    return objects.map(o => o.message).filter(m => m).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }

  sendMessage = async (threadID: string, content: MessageContent, options?: MessageSendOptions): Promise<boolean> => {
    await this.waitUntilReady()

    // @ts-expect-error replaceAll
    const text = content.text?.replaceAll(/@([^#@]{3,32}#[0-9]{4})/gi, (_, username) => {
      const user = Array.from(this.userMappings).find(u => u[1] === username)
      if (user) return `<@!${user[0]}>`
      return username
    })

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

    // @ts-expect-error replaceAll
    const text = content.text?.replaceAll(/@([^#@]{3,32}#[0-9]{4})/gi, (_, username) => {
      const user = Array.from(this.userMappings).find(u => u[1] === username)
      if (user) return `<@!${user[0]}>`
      return username
    })

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
          payload.relationships?.forEach(r => this.userMappings.set(r.id, (r.username + '#' + r.discriminator)))
          payload.read_state?.entries?.forEach(p => this.readStateMap.set(p.id, p.last_message_id))
          // apparently there's no presences when acting as a user
        } else {
          payload.relationships?.forEach(r => this.userMappings.set(r.id, (r.user.username + '#' + r.user.discriminator)))
          payload.read_state?.forEach(p => this.readStateMap.set(p.id, p.last_message_id))
          payload.presences?.forEach(p => {
            this.usersPresence[p.user.id] = { userID: p.user.id, isActive: p.status === 'online', lastActive: new Date(+p.last_modified) }
          })
        }

        if (ENABLE_GUILDS) {
          payload.guilds.forEach(guild => {
            const guildID: string = guild.id
            const guildName: string = guild.name
            const guildJoinDate: Date = new Date(guild.joined_at)
            const guildIconID: string | undefined = guild.icon

            const channels = guild.channels
              .filter(c => !IGNORED_CHANNEL_TYPES.includes(c.type))
              .map(c => mapChannel(c, guildID, guildJoinDate, guildName, guildIconID))

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

        const channel = mapChannel(payload, payload.guild_id, new Date())
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
        const newChannel = mapChannel(payload, payload.guild_id)
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
        const guildJoinDate: Date = new Date(payload.joined_at)
        const guildIconID: string | undefined = payload.icon

        const channels = payload.channels
          .filter(c => !IGNORED_CHANNEL_TYPES.includes(c.type))
          .map(c => mapChannel(c, guildID, guildJoinDate, guildName, guildIconID))

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

        console.log(payload)
        break
      }

      case GatewayMessageType.GUILD_INTEGRATIONS_UPDATE: {
        // this doesn't do anything we should care about
        break
      }

      case GatewayMessageType.GUILD_MEMBER_ADD: {
        // TODO: GUILD_MEMBER_ADD

        console.log(payload)
        break
      }

      case GatewayMessageType.GUILD_MEMBER_REMOVE: {
        // TODO: GUILD_MEMBER_REMOVE

        console.log(payload)
        break
      }

      case GatewayMessageType.GUILD_MEMBER_UPDATE: {
        // TODO: GUILD_MEMBER_UPDATE

        console.log(payload)
        break
      }

      case GatewayMessageType.GUILD_MEMBERS_CHUNK: {
        // TODO: GUILD_MEMBERS_CHUNK

        console.log(payload)
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
        const message = mapMessage(payload, this.currentUser?.id, null, this.userMappings)
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

        const message = mapMessage(payload, this.currentUser?.id, null, this.userMappings)
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
        if (!ENABLE_GUILDS && payload.guild_id) return

        if (payload.guild_id) {
          // TODO: Guild updates
          console.log(payload)
        } else {
          this.usersPresence[payload.user.id] = { userID: payload.user.id, isActive: payload.status === 'online', lastActive: new Date(+payload.last_modified) }
          this.eventCallback?.([{
            type: ServerEventType.USER_PRESENCE_UPDATED,
            presence: {
              userID: payload.user.id,
              isActive: payload.status === 'online',
              lastActive: new Date(),
            },
          }])
        }

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
        /*
          {
            guild_id: '446735637413101578',
            channel_unread_updates: [
              { last_message_id: '837454835996688415', id: '803344792196349952' },
              { last_message_id: '845991118638415912', id: '765982013097771019' },
              { last_message_id: '845780339904479251', id: '845760520518500448' },
              { last_message_id: '827034186418094122', id: '804205093640732672' },
              { last_message_id: '808420610853699585', id: '779209345543569428' },
              { last_message_id: '845963644805447680', id: '803347908585455646' },
              { last_message_id: '816355044470423553', id: '600780284727918621' },
              { last_message_id: '775476235760435210', id: '775476191414976512' },
              { last_message_id: '639992280207458318', id: '632815235929079809' },
              { last_message_id: '755567700448772206', id: '620717969475108864' },
              { last_message_id: '845678366551572490', id: '844939443604946984' },
              { last_message_id: '590634589878354005', id: '527620730624409605' },
              { last_message_id: '774980921404293130', id: '687368836776722494' },
              { last_message_id: '846001802998054923', id: '758557245553770496' },
              { last_message_id: '805003986729697280', id: '765796296925118476' },
              { last_message_id: '803319970955395112', id: '463096764908699650' },
              { last_message_id: '845741650089082900', id: '750303273705013331' },
              { last_message_id: '845984724450148382', id: '808461770501914644' },
              { last_message_id: '844959944280768552', id: '528382698243489792' },
              { last_message_id: '845752327038435379', id: '845741198894432276' },
              { last_message_id: '803342178407022623', id: '528345644172181505' },
              { last_message_id: '776133694054203433', id: '749297798440288266' },
              { last_message_id: '822129392724606996', id: '564312311536418827' },
              { last_message_id: '845968953645072404', id: '454003678316199936' },
              { last_message_id: '806540587146674217', id: '806540518002655252' },
              { last_message_id: '845953968832380949', id: '845733861324226560' },
              { last_message_id: '791789268069908521', id: '755572121060507730' },
              { last_message_id: '845987358280777769', id: '806540694600417361' },
              { last_message_id: '844668352130842705', id: '604515992625872936' },
              { last_message_id: '845947327364857916', id: '806551636805025802' },
              { last_message_id: '845069982655184906', id: '792957607710162964' },
              { last_message_id: '845708229387223051', id: '845686193018110002' },
              { last_message_id: '846002288337354762', id: '704243125350039594' },
              { last_message_id: '740746303855919125', id: '629355710777655307' },
              { last_message_id: '737812628394606713', id: '672923048134836244' },
              { last_message_id: '842869426742099969', id: '839690313206726726' },
              { last_message_id: '844297050899087360', id: '480118838323838976' },
              { last_message_id: '816361216690749450', id: '816192166593560626' },
              { last_message_id: '843311826259410976', id: '743802746251247647' },
              { last_message_id: '846002289579655168', id: '704246988299829268' },
              { last_message_id: '845977100992512040', id: '760424469453078558' },
              { last_message_id: '845993468722806794', id: '803341572002676878' },
              { last_message_id: '817859901886824499', id: '756171115055022210' },
              { last_message_id: '804971635395657758', id: '765980543220842507' },
              { last_message_id: '808431092913668106', id: '714373034705682432' },
              { last_message_id: '846001031803830292', id: '480426454186983424' },
              { last_message_id: '751638825658351716', id: '750513660178464849' },
              { last_message_id: '746806804377370794', id: '528338732353454090' },
              { last_message_id: '842577625629196288', id: '527943332152999946' },
              { last_message_id: '845987622526124042', id: '762134532282515516' },
              { last_message_id: '846001699176841256', id: '461385329300078592' },
              { last_message_id: '819952262470172682', id: '817999432624242720' },
              { last_message_id: '807400325194579988', id: '747102589300113418' },
              { last_message_id: '750421107194069163', id: '710256160900382781' },
              { last_message_id: '844687834862321725', id: '750067683638116492' },
              { last_message_id: '771172910395162625', id: '704242612336590980' },
              { last_message_id: '846002215520436224', id: '704482572578586635' },
              { last_message_id: '833042913062813757', id: '742867361480179753' },
              { last_message_id: '845026052497342504', id: '479874599019085824' },
              { last_message_id: '844693175280730172', id: '819397514293411881' },
              { last_message_id: '804771685344870461', id: '803332558410088458' },
              { last_message_id: '846000032741720074', id: '529045665670627359' },
              { last_message_id: '844320419921788948', id: '705838171337916456' },
              { last_message_id: '808431296954105906', id: '779209264840310824' },
              { last_message_id: '745424423401684994', id: '493960931835904009' },
              { last_message_id: '845987677803511858', id: '454003486728912906' },
              { last_message_id: '846001950218911774', id: '750971214276591686' },
              { last_message_id: '827225079196155924', id: '735965445366087731' },
              { last_message_id: '827636271710732359', id: '804815813676236819' },
              { last_message_id: '845999725424672778', id: '803349500528689222' },
              { last_message_id: '845926874777518140', id: '845923635654426624' },
              { last_message_id: '737412251392409630', id: '687376044785008741' },
              { last_message_id: '818890935110860901', id: '818888079288827924' },
              { last_message_id: '755597420498386994', id: '446739991305912320' },
              { last_message_id: '845939089378770944', id: '803341446936657921' },
              { last_message_id: '845912213130706945', id: '844676880564879390' },
              { last_message_id: '845187550925684777', id: '806546317702594590' },
              { last_message_id: '845999887178661898', id: '803700733723017267' },
              { last_message_id: '845319344074391562', id: '839690231133110352' },
              { last_message_id: '846000988129198081', id: '628384809671983105' },
              { last_message_id: '845922781185966131', id: '806540645069226035' },
              { last_message_id: '814300598923952189', id: '804812074584768512' },
              { last_message_id: '829455405108822068', id: '803698123771478107' },
              { last_message_id: '845998153883058206', id: '806540312880611363' },
              { last_message_id: '845324570880770138', id: '753747659193581588' },
              { last_message_id: '838813332789788722', id: '806881466481901618' },
              { last_message_id: '806545454505525250', id: '806544918553690142' },
              { last_message_id: '779462131535052810', id: '759139463808417812' },
              { last_message_id: '845865785317654528', id: '814246713937887272' },
              { last_message_id: '808378867890520085', id: '808354011514011658' },
              { last_message_id: '771459367387267143', id: '750624442186465290' },
              { last_message_id: '845874738232295465', id: '767402023221592124' },
              { last_message_id: '837721428882882601', id: '803321014753951854' },
              { last_message_id: '804094648855429160', id: '804026339107536897' },
              { last_message_id: '846000415362777138', id: '454442808112316429' },
              { last_message_id: '845985993013329943', id: '812404235709972550' },
              { last_message_id: '766450974461657108', id: '766450894572486656' },
              { last_message_id: '748359487034753086', id: '708074964468629578' },
              { last_message_id: '845954371094708254', id: '755542896257663039' },
              { last_message_id: '836744594112380949', id: '836653755956461588' },
              ... 3 more items
            ]
          }
        */

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

  /* private onGatewayMessage = (opcode, payload, type) => {
    switch (type) {
      case GatewayMessageType.HELLO:
        break

      case GatewayMessageType.INVALID_SESSION:
        this.ready = false
        break

      case GatewayMessageType.READY:
        // const notes = payload.notes
        // const user_settings = payload.user_settings

        if (ACT_AS_USER) {
          payload.relationships?.forEach(r => this.userMappings.set(r.id, (r.username + '#' + r.discriminator)))
          payload.read_state?.entries?.forEach(p => this.readStateMap.set(p.id, p.last_message_id))
          // apparently there's no presences when acting as a user
        } else {
          payload.relationships?.forEach(r => this.userMappings.set(r.id, (r.user.username + '#' + r.user.discriminator)))
          payload.read_state?.forEach(p => this.readStateMap.set(p.id, p.last_message_id))
          payload.presences?.forEach(p => {
            this.usersPresence[p.user.id] = { userID: p.user.id, isActive: p.status === 'online', lastActive: new Date(+p.last_modified) }
          })
        }

        if (ENABLE_GUILDS) {
          payload.guilds.forEach(guild => {
            const guildID: string = guild.id
            const guildName: string = guild.name
            const guildJoinDate: Date = new Date(guild.joined_at)
            const guildIconID: string | undefined = guild.icon

            const channels = guild.channels.map(c => mapChannel(c, guildID, guildName, guildJoinDate, guildIconID))
            this.channelsMap.set(guildID, channels)
          })
        }

        this.gotInitialUserData = true
        break

      case GatewayMessageType.RECONNECT:
        console.log('RECONNECT')
        break

      case GatewayMessageType.RESUMED:
        this.ready = true
        break

      case GatewayMessageType.CHANNEL_CREATE:
        if (payload.guild_id && !ENABLE_GUILDS) return
        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'upsert',
          objectName: 'thread',
          objectIDs: {
            threadID: payload.id,
          },
          entries: [
            {
              id: payload.id,
              isUnread: true,
            },
          ],
        }])
        break

      case GatewayMessageType.CHANNEL_UPDATE:
        if (payload.guild_id && !ENABLE_GUILDS) return
        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'update',
          objectName: 'thread',
          objectIDs: {
            threadID: payload.id,
          },
          entries: [
            {
              id: payload.id,
              isUnread: true,
            },
          ],
        }])
        break

      case GatewayMessageType.CHANNEL_DELETE:
        if (payload.guild_id && !ENABLE_GUILDS) return
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

      case GatewayMessageType.MESSAGE_DELETE:
        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'delete',
          objectName: 'message',
          objectIDs: { threadID: payload.channel_id },
          entries: [payload.id],
        }])
        break

      case GatewayMessageType.CHANNEL_PINS_UPDATE:
      case GatewayMessageType.MESSAGE_CREATE:
      case GatewayMessageType.MESSAGE_UPDATE:
        if (payload.guild_id && !ENABLE_GUILDS) return
        this.eventCallback?.([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: payload.channel_id }])
        break

      case GatewayMessageType.MESSAGE_DELETE_BULK: {
        if (ACT_AS_USER) {
          console.log('MDB', payload)
        } else {
          console.log('MDB', payload)
        }

        // this.eventCallback?.(messages.map(m => ({ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: m.channel_id })))
        break
      }

      case GatewayMessageType.MESSAGE_ACK:
      case GatewayMessageType.CHANNEL_UNREAD_UPDATE:
        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'update',
          objectName: 'thread',
          objectIDs: {
            threadID: payload.channel_id,
          },
          entries: [
            {
              id: payload.channel_id,
              isUnread: false,
            },
          ],
        }])
        break

      case GatewayMessageType.MESSAGE_REACTION_ADD:
      case GatewayMessageType.MESSAGE_REACTION_REMOVE:
      case GatewayMessageType.MESSAGE_REACTION_REMOVE_ALL:
      case GatewayMessageType.MESSAGE_REACTION_REMOVE_EMOJI:
        if (payload.guild_id && !ENABLE_GUILDS) return
        this.eventCallback?.([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: payload.channel_id }])
        break

      case GatewayMessageType.TYPING_START:
        this.eventCallback?.([{ type: ServerEventType.PARTICIPANT_TYPING, typing: true, participantID: payload.user_id, threadID: payload.channel_id }])
        break

      case GatewayMessageType.PRESENCE_UPDATE:
        if (payload.guild_id && !ENABLE_GUILDS) return
        this.usersPresence[payload.user.id] = { userID: payload.user.id, isActive: payload.status === 'online', lastActive: new Date(+payload.last_modified) }
        this.eventCallback?.([{
          type: ServerEventType.USER_PRESENCE_UPDATED,
          presence: {
            userID: payload.user.id,
            isActive: payload.status === 'online',
            lastActive: new Date(),
          },
        }])
        break

      case GatewayMessageType.USER_UPDATE:
      case GatewayMessageType.USER_SETTINGS_UPDATE:
        console.log('USER_*', opcode, type, payload)
        break

      case GatewayMessageType.RELATIONSHIP_ADD:
      case GatewayMessageType.RELATIONSHIP_REMOVE:
        this.getUserFriends()
        break

      case GatewayMessageType.GUILD_CREATE:
      case GatewayMessageType.GUILD_UPDATE: {
        if (!ENABLE_GUILDS) return

        const guildID: string = payload.id
        const guildName: string = payload.name
        const guildJoinDate: Date = new Date(payload.joined_at)
        const guildIconID: string | undefined = payload.icon

        const channels = payload.channels.map(c => mapChannel(c, guildID, guildName, guildJoinDate, guildIconID))
        this.channelsMap.set(guildID, channels)

        this.eventCallback?.([{
          type: ServerEventType.STATE_SYNC,
          mutationType: 'upsert',
          objectName: 'thread',
          objectIDs: {
            threadID: guildID,
          },
          entries: [
            {
              id: guildID,
              isUnread: true,
            },
          ],
        }])

        const events: ServerEvent[] = channels.map(c => ({
          type: ServerEventType.STATE_SYNC,
          objectIDs: {
            threadID: c.id,
          },
          mutationType: 'upsert',
          objectName: 'thread',
          entries: [{ id: c.id, isUnread: true }],
        }))
        this.eventCallback?.(events)
        break
      }

      case GatewayMessageType.GUILD_DELETE: {
        if (!ENABLE_GUILDS) return
        const guildID = payload.id
        this.channelsMap.delete(guildID)

        const channelIDs = payload.channels.map(c => c.id);
        const events: ServerEvent[] = channelIDs.map(id => ({
          type: ServerEventType.STATE_SYNC,
          objectIDs: {
            threadID: id,
          },
          mutationType: 'delete',
          objectName: 'thread',
          entries: [{ id }],
        }))
        this.eventCallback?.(events)

        break
      }

      case GatewayMessageType.GUILD_MEMBER_UPDATE: {
        if (!ENABLE_GUILDS) return
        const guildID = payload.guild_id

        console.log('GUILD_MEMBER_UPDATE', payload)
        break
      }

      case GatewayMessageType.READY_SUPPLEMENTAL:
      case GatewayMessageType.GUILD_BAN_ADD:
      case GatewayMessageType.VOICE_STATE_UPDATE:
        // we're ignoring these ones, but we want to catch unhandled/private messages in the `default` handler
        break

      default:
        console.log('[UNHANDLED GATEWAY MESSAGE]', opcode, type, payload)
        break
    }
  } */

  private handleErrors = (json: any, statusCode: number) => {
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    if (statusCode === 401) throw new ReAuthError('Unauthorized')
    if (json.message && json.code) texts.error(json)
  }

  private waitForInitialData = async () => {
    while (!this.gotInitialUserData) await sleep(100)
  }

  private waitUntilReady = async () => {
    while (!this.ready && WAIT_TILL_READY) await sleep(100)
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
