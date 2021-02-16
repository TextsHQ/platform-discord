import got from 'got'
import fs from 'fs'
import FormData from 'form-data'
import { CookieJar } from 'tough-cookie'
import { texts, CurrentUser, MessageContent, PaginationArg, Thread, Message as TextsMessage, ServerEventType, OnServerEventCallback, ActivityType, User, InboxName, MessageSendOptions, ReAuthError, PresenceMap } from '@textshq/platform-sdk'
import { mapCurrentUser, mapMessage, mapThread, mapUser } from './mappers'
import WSClient from './websocket/wsclient'
import { GatewayCloseCode, GatewayMessageType } from './websocket/constants'

const API_ENDPOINT = 'https://discord.com/api/v8/'
const WAIT_TILL_READY = true
const RESTART_ON_FAIL = true
const LIMIT_COUNT = 25
const ACT_AS_USER = true

async function sleep(time: number) {
  return new Promise(resolve => setTimeout(resolve, time))
}

export default class DiscordAPI {
  private token?: string

  private client?: WSClient

  // ID-to-username mappings
  private userMappings: Map<string, string> = new Map()

  private unreadThreads: Map<string, string> = new Map()

  private unloadedThreads: Map<string, any> = new Map()

  private usersPresence: PresenceMap = {}

  private gotInitialUserData: boolean = false

  public cookieJar?: CookieJar

  public eventCallback?: OnServerEventCallback

  public startPolling?: () => void

  public stopPolling?: () => void

  public ready: boolean = false

  public currentUser?: CurrentUser

  public userFriends: User[] = []

  // MARK: - Public functions

  public login = async (cookieJar: CookieJar) => {
    if (!cookieJar) throw TypeError()
    this.cookieJar = cookieJar

    const cookies = this.cookieJar.getCookiesSync('https://discord.com')
    this.token = cookies.find(c => c.key === 'token')?.value

    if (!this.token) throw new Error('No token found.')

    this.setupWebsocket()
  }

  public logout = async () => {
    this.fetch({ method: 'POST', url: 'auth/logout', json: { provider: null, voip_provider: null } })
    this.client = null
  }

  public dispose = () => {
    this.ready = false
    this.client?.disconnect()
    this.client = null
  }

  public setupWebsocket = async () => {
    const gatewayRes = await got({ url: `${API_ENDPOINT}/gateway` })
    const gateway: string = JSON.parse(gatewayRes?.body)?.url ?? 'wss://gateway.discord.gg'

    this.client = null
    this.client = new WSClient(`${gateway}/?v=8&encoding=etf`, this.token, ACT_AS_USER)
    this.client.restartOnFail = RESTART_ON_FAIL

    this.setupGatewayListeners()
  }

  public getCurrentUser = async (): Promise<CurrentUser> => {
    const res = await this.fetch({ method: 'GET', url: 'users/@me' })
    if (!res?.body) throw new Error('No response')

    const currentUser: CurrentUser = mapCurrentUser(JSON.parse(res?.body))
    this.currentUser = currentUser
    this.userMappings.set(currentUser.id, currentUser.displayText)

    this.getUserFriends()

    return currentUser
  }

  public getThreads = async (inboxName: InboxName, pagination?: PaginationArg): Promise<{ items: Thread[], hasMore: boolean }> => {
    const res = await this.fetch({ method: 'GET', url: 'users/@me/channels' })
    if (!res?.body) throw new Error('No response')

    const threads: Thread[] = await Promise.all(JSON.parse(res?.body)
      .sort((a, b) => a.last_message_id - b.last_message_id)
      .map(async (thread, index) => {
        const lastMessage = await this.getLastMessage(thread.id, index)
        return mapThread(thread, this.unreadThreads.get(thread.id) != null, this.currentUser, lastMessage, this.userMappings)
      }))

    return { items: threads, hasMore: this.unloadedThreads.size > 0 }
  }

  public createThread = async (userIDs: string[], title?: string): Promise<boolean | Thread> => {
    if (userIDs.length === 1 && userIDs[0] === this.currentUser?.id) return false

    await this.waitUntilReady()

    const res = await this.fetch({
      method: 'POST',
      url: 'users/@me/channels',
      json: userIDs.length === 1 ? { recipient_id: userIDs[0] } : { recipients: userIDs },
    })

    if (!res?.body) throw new Error('No response')
    return mapThread(JSON.parse(res?.body), false, this.currentUser, null, this.userMappings)
  }

  public archiveThread = async (threadID: string) => {
    await this.fetch({ method: 'DELETE', url: `channels/${threadID}` })
  }

  public getMessages = async (threadID: string, pagination?: PaginationArg): Promise<TextsMessage[]> => {
    if (!this.currentUser) throw new Error('No current user')
    const currentUser = this.currentUser

    await this.waitUntilReady()

    const options = {
      before: (pagination?.direction === 'before') ? pagination?.cursor : undefined,
      after: (pagination?.direction === 'after') ? pagination?.cursor : undefined,
    }

    const paginationQuery = options.before ? `before=${options.before}` : options.after ? `after=${options.after}` : ''
    const res = await this.fetch({ method: 'GET', url: `channels/${threadID}/messages?limit=50&${paginationQuery}` })
    if (!res?.body) throw new Error('No response')

    const messages: TextsMessage[] = await Promise.all(JSON.parse(res?.body)
      .map(async m => {
        let reactionsDetails
        if (m.reactions) {
          reactionsDetails = await Promise.all(m.reactions.map(async r => {
            const emojiQuery = encodeURIComponent(r.emoji.id ? `${r.emoji.name}:${r.emoji.id}` : r.emoji.name)
            const reactedRes = await this.fetch({ method: 'GET', url: `channels/${threadID}/messages/${m.id}/reactions/${emojiQuery}` })
            const parsed = JSON.parse(reactedRes?.body)
            if (parsed) return { emoji: r.emoji, users: parsed }
            return null
          }))
        }

        return mapMessage(m, currentUser.id, reactionsDetails, this.userMappings)
      }))

    return messages.filter(m => m).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }

  public sendMessage = async (threadID: string, content: MessageContent, options?: MessageSendOptions): Promise<boolean> => {
    await this.waitUntilReady()

    const method = 'POST'
    const url = `channels/${threadID}/messages`

    // @ts-expect-error
    const text = content.text?.replaceAll(/@([^#@]{3,32}#[0-9]{4})/gi, (_, username) => {
      const user = Array.from(this.userMappings).find(u => u[1] === username)
      if (user) return `<@!${user[0]}>`
      return username
    })

    const requestContent = {
      headers: {},
      message_reference: undefined,
      text,
      json: undefined,
      body: undefined,
    }

    if (options?.quotedMessageID) {
      requestContent.message_reference = { message_id: options?.quotedMessageID }
    }

    if (content.fileBuffer || content.fileName || content.filePath) {
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
        content: requestContent.text || '',
        tts: false,
        message_reference: requestContent.message_reference,
      }
      form.append('payload_json', JSON.stringify(payload_json))

      requestContent.headers = form.getHeaders()
      requestContent.body = form
    } else {
      requestContent.headers = { 'Content-Type': 'application/json' }
      requestContent.json = {
        content: requestContent.text,
        tts: false,
        message_reference: requestContent.message_reference,
      }
    }

    const requestData = { url, method, headers: requestContent.headers, json: requestContent.json, body: requestContent.body }
    const res = await this.fetch(requestData)
    return res?.statusCode === 200
  }

  public deleteMessage = async (threadID: string, messageID: string, forEveryone?: boolean): Promise<boolean> => {
    if (!forEveryone) return true

    await this.waitUntilReady()

    const res = await this.fetch({ method: 'DELETE', url: `channels/${threadID}/messages/${messageID}` })
    return res?.statusCode === 204
  }

  public sendReadReceipt = async (threadID: string, messageID: string) => {
    await this.waitUntilReady()
    const res = await this.fetch({ method: 'POST', url: `channels/${threadID}/messages/${messageID || this.unreadThreads.get(threadID)}/ack`, json: { token: null } })
    if (res?.statusCode === 204) this.unreadThreads.delete(threadID)
  }

  public addReaction = async (threadID: string, messageID: string, reactionKey: string): Promise<boolean> => {
    await this.waitUntilReady()

    const res = await this.fetch({ method: 'PUT', url: `channels/${threadID}/messages/${messageID}/reactions/${encodeURIComponent(reactionKey)}/@me` })
    return res?.statusCode === 204
  }

  public removeReaction = async (threadID: string, messageID: string, reactionKey: string): Promise<boolean> => {
    await this.waitUntilReady()

    const res = await this.fetch({ method: 'DELETE', url: `channels/${threadID}/messages/${messageID}/reactions/${encodeURIComponent(reactionKey)}/@me` })
    return res?.statusCode === 204
  }

  public setTyping = async (type: ActivityType, threadID: string): Promise<void> => {
    if (type === ActivityType.TYPING && this.ready) this.fetch({ method: 'POST', url: `channels/${threadID}/typing` })
  }

  public getUsersPresence = async () => {
    while (!this.gotInitialUserData) await sleep(1000)
    return this.usersPresence
  }

  // - MARK: Private functions

  private getUserFriends = async () => {
    const res = await this.fetch({ method: 'GET', url: 'users/@me/relationships' })
    if (!res?.body) throw new Error('No response')
    this.userFriends = JSON.parse(res?.body).filter(f => f.type === 1) // Only friends
      .map(f => mapUser(f.user))
  }

  private getLastMessage = async (threadID: string, index: number): Promise<any | null> => {
    if (index > LIMIT_COUNT) return
    const res = await this.fetch({ method: 'GET', url: `channels/${threadID}/messages?limit=1` })
    if (!res?.body || res.body.length === 0) return
    return JSON.parse(res?.body)[0]
  }

  private setupGatewayListeners = () => {
    if (!this.client) throw new Error('WSClient not initialized!')

    this.client.onChangedReadyState = ready => {
      texts.log('Connection state: ' + ready)
      this.ready = ready
    }

    this.client.onConnectionClosed = (code, reason) => {
      texts.log('Connection to websocket closed with code ' + code + '. Reason: ' + reason)
      this.ready = false

      switch (code) {
        case GatewayCloseCode.ADDRESS_NOT_FOUND:
          this.startPolling?.()
          break
        case GatewayCloseCode.RECONNECT_REQUESTED:
          texts.log('Gateway requested client reconnect.')
          break
        case GatewayCloseCode.AUTHENTICATION_FAILED:
          this.client = null
          throw new ReAuthError('Access token invalid')
        case GatewayCloseCode.SESSION_TIMED_OUT:
          texts.log('Gateway session timed out.')
          break
        default:
          break
      }
    }

    this.client.onError = error => {
      throw error
    }

    this.client.onMessage = (opcode, payload, type) => {
      switch (type) {
        case GatewayMessageType.HELLO:
          break

        case GatewayMessageType.INVALID_SESSION:
          break

        case GatewayMessageType.READY:
          // const notes = payload.notes
          // const user_settings = payload.user_settings

          if (ACT_AS_USER) {
            payload.relationships?.forEach(r => this.userMappings.set(r.id, (r.username + '#' + r.discriminator)))
            payload.read_state?.entries?.filter(p => p.mention_count > 0).forEach(p => this.unreadThreads.set(p.id, p.last_message_id))
            // apparently there's no presences when acting as a user
          } else {
            payload.relationships?.forEach(r => this.userMappings.set(r.id, (r.user.username + '#' + r.user.discriminator)))
            payload.read_state?.filter(p => p.mention_count > 0).forEach(p => this.unreadThreads.set(p.id, p.last_message_id))
            payload.presences?.forEach(p => {
              this.usersPresence[p.user.id] = { userID: p.user.id, isActive: p.status === 'online', lastActive: new Date(parseInt(p.last_modified)) }
            })
          }

          this.gotInitialUserData = true
          break

        case GatewayMessageType.RECONNECT:
          break

        case GatewayMessageType.RESUMED:
          break

        case GatewayMessageType.CHANNEL_CREATE:
          if (payload.guild_id) return
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
          if (payload.guild_id) return
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

        case GatewayMessageType.CHANNEL_PINS_UPDATE:
        case GatewayMessageType.CHANNEL_UPDATE:
        case GatewayMessageType.MESSAGE_CREATE:
        case GatewayMessageType.MESSAGE_DELETE:
        case GatewayMessageType.MESSAGE_UPDATE:
          if (payload.guild_id) return
          this.eventCallback?.([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: payload.channel_id }])
          break

        case GatewayMessageType.MESSAGE_ACK:
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

        case GatewayMessageType.MESSAGE_DELETE_BULK:
          const messages = ACT_AS_USER ? payload.filter(m => !m.guild_id) : payload
          this.eventCallback?.(messages.map(m => ({ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: m.channel_id })))
          break

        case GatewayMessageType.MESSAGE_REACTION_ADD:
        case GatewayMessageType.MESSAGE_REACTION_REMOVE:
        case GatewayMessageType.MESSAGE_REACTION_REMOVE_ALL:
        case GatewayMessageType.MESSAGE_REACTION_REMOVE_EMOJI:
          if (payload.guild_id) return
          this.eventCallback?.([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: payload.channel_id }])
          break

        case GatewayMessageType.TYPING_START:
          this.eventCallback?.([{ type: ServerEventType.PARTICIPANT_TYPING, typing: true, participantID: payload.user_id, threadID: payload.channel_id }])
          break

        case GatewayMessageType.PRESENCE_UPDATE:
          if (payload.guild_id) return
          this.usersPresence[payload.user.id] = { userID: payload.user.id, isActive: payload.status === 'online', lastActive: new Date(parseInt(payload.last_modified)) }
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
          break

        case GatewayMessageType.RELATIONSHIP_ADD:
        case GatewayMessageType.RELATIONSHIP_REMOVE:
          this.getUserFriends()
          break

        default:
          break
      }
    }
  }

  private handleErrors = (json: any, statusCode: number) => {
    if (statusCode === 401) throw new ReAuthError('Unauthorized')
    if (json.message && json.code) texts.error(json)
  }

  private waitUntilReady = async () => {
    while (!this.ready && WAIT_TILL_READY) await sleep(1000)
  }

  private fetch = async ({ headers = {}, ...rest }) => {
    try {
      const res = await got({
        throwHttpErrors: false,
        prefixUrl: API_ENDPOINT,
        timeout: 10000,
        headers: {
          'User-Agent': texts.constants.USER_AGENT,
          'Accept-Encoding': 'gzip, deflate, br',
          Authorization: this.token,
          ...headers,
        },
        ...rest,
      })

      if (res?.body && JSON.parse(res?.body)) this.handleErrors(JSON.parse(res?.body), res.statusCode)
      return res
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
