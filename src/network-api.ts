import got from 'got'
import fs from 'fs'
import FormData from 'form-data'
import { CookieJar } from 'tough-cookie'
import { texts, CurrentUser, MessageContent, PaginationArg, Thread, Message as TextsMessage, ServerEventType, OnServerEventCallback, ActivityType, OnConnStateChangeCallback, User, InboxName, MessageSendOptions } from '@textshq/platform-sdk'
import { Client as DiscordClient } from 'better-discord.js'
import { mapCurrentUser, mapMessage, mapThread, mapUser } from './mappers'
import { VERSION } from './constants'

const API_ENDPOINT = 'https://discord.com/api/v8/'
const LIMIT_COUNT = 25
const WAIT_TILL_READY = true
const RESTART_ON_FAIL = true

function handleErrors(json: any) {
  if (json.message && json.code) throw new Error(json.message)
}

async function sleep(time: number) {
  return new Promise(resolve => setTimeout(resolve, time))
}

export default class DiscordAPI {
  private token?: string

  private readonly client: DiscordClient = new DiscordClient()

  // ID-to-username mappings
  private userMappings: Map<string, string> = new Map()

  public cookieJar?: CookieJar

  public eventCallback?: OnServerEventCallback

  public connectionStateChangeCallback?: OnConnStateChangeCallback

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

    this.client.login(this.token, false)
    this.setupGatewayListeners()
  }

  public logout = async () => {
    this.fetch({ method: 'POST', url: 'auth/logout', json: { provider: null, voip_provider: null } })
  }

  public dispose = () => {
    this.ready = false
    this.client.destroy()
  }

  public getCurrentUser = async (): Promise<CurrentUser> => {
    const res = await this.fetch({ method: 'GET', url: 'users/@me' })
    if (!res.body) throw new Error('No response')

    const currentUser: CurrentUser = mapCurrentUser(JSON.parse(res.body))
    this.currentUser = currentUser
    this.userMappings.set(currentUser.id, currentUser.displayText)

    this.getUserFriends()

    return currentUser
  }

  public getThreads = async (inboxName: InboxName, pagination?: PaginationArg): Promise<{ items: Thread[], hasMore: boolean }> => {
    const res = await this.fetch({ method: 'GET', url: 'users/@me/channels' })
    if (!res.body) throw new Error('No response')

    const threads: Thread[] = await Promise.all(JSON.parse(res.body).map(async (thread, index) => {
      let messages
      if (index <= LIMIT_COUNT) {
        const messagesRes = await this.fetch({ method: 'GET', url: `channels/${thread.id}/messages?limit=1` })
        messages = JSON.parse(messagesRes.body)
        thread.recipients.forEach(r => this.userMappings.set(r.id, (r.username + '#' + r.discriminator)))
      }

      return mapThread(thread, this.currentUser, (messages?.length > 0 ? messages[0] : undefined), this.userMappings)
    }))

    return { items: threads, hasMore: false }
  }

  public createThread = async (userIDs: string[], title?: string): Promise<boolean | Thread> => {
    while (!this.ready && WAIT_TILL_READY) await sleep(1000)

    const res = await this.fetch({
      method: 'POST',
      url: 'users/@me/channels',
      json: userIDs.length === 1 ? { recipient_id: userIDs[0] } : { recipients: userIDs },
    })

    if (!res.body) throw new Error('No response')
    return mapThread(JSON.parse(res.body), this.currentUser, null, this.userMappings)
  }

  public archiveThread = async (threadID: string) => {
    await this.fetch({ method: 'DELETE', url: `channels/${threadID}` })
  }

  public getMessages = async (threadID: string, pagination?: PaginationArg): Promise<TextsMessage[]> => {
    if (!this.currentUser) throw new Error('No current user')
    const currentUser = this.currentUser

    while (!this.ready && WAIT_TILL_READY) await sleep(1000)

    const options = {
      before: (pagination?.direction === 'before') ? pagination?.cursor : undefined,
      after: (pagination?.direction === 'after') ? pagination?.cursor : undefined,
    }

    const paginationQuery = options.before ? `before=${options.before}` : options.after ? `after=${options.after}` : ''
    const res = await this.fetch({ method: 'GET', url: `channels/${threadID}/messages?limit=50&${paginationQuery}` })
    if (!res.body) throw new Error('No response')

    const messages: TextsMessage[] = await Promise.all(JSON.parse(res.body)
      .map(async m => {
        let reactionsDetails
        if (m.reactions) {
          reactionsDetails = await Promise.all(m.reactions.map(async r => {
            const emojiQuery = encodeURIComponent(r.emoji.id ? `${r.emoji.name}:${r.emoji.id}` : r.emoji.name)
            const reactedRes = await this.fetch({ method: 'GET', url: `channels/${threadID}/messages/${m.id}/reactions/${emojiQuery}` })
            const parsed = JSON.parse(reactedRes.body)
            if (parsed) return { emoji: r.emoji, users: parsed }
            return null
          }))
        }

        return mapMessage(m, currentUser.id, reactionsDetails, this.userMappings)
      }))

    return messages.filter(m => m).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }

  public sendMessage = async (threadID: string, content: MessageContent, options?: MessageSendOptions): Promise<boolean> => {
    while (!this.ready && WAIT_TILL_READY) await sleep(1000)

    const method = 'POST'
    const url = `channels/${threadID}/messages`
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
    return res.statusCode === 200
  }

  public deleteMessage = async (threadID: string, messageID: string, forEveryone?: boolean): Promise<boolean> => {
    if (!forEveryone) return true

    while (!this.ready && WAIT_TILL_READY) await sleep(1000)

    const res = await this.fetch({ method: 'DELETE', url: `channels/${threadID}/messages/${messageID}` })
    return res.statusCode === 204
  }

  public sendReadReceipt = async (threadID: string, messageID: string) => {
    while (!this.ready && WAIT_TILL_READY) await sleep(1000)
    await this.fetch({ method: 'POST', url: `channels/${threadID}/messages/${messageID}/ack`, json: { token: null } })
  }

  public addReaction = async (threadID: string, messageID: string, reactionKey: string): Promise<boolean> => {
    while (!this.ready && WAIT_TILL_READY) await sleep(1000)

    const res = await this.fetch({ method: 'PUT', url: `channels/${threadID}/messages/${messageID}/reactions/${encodeURIComponent(reactionKey)}/@me` })
    return res.statusCode === 204
  }

  public removeReaction = async (threadID: string, messageID: string, reactionKey: string): Promise<boolean> => {
    while (!this.ready && WAIT_TILL_READY) await sleep(1000)

    const res = await this.fetch({ method: 'DELETE', url: `channels/${threadID}/messages/${messageID}/reactions/${encodeURIComponent(reactionKey)}/@me` })
    return res.statusCode === 204
  }

  public setTyping = async (type: ActivityType, threadID: string): Promise<void> => {
    if (type === ActivityType.TYPING && this.ready) this.fetch({ method: 'POST', url: `channels/${threadID}/typing` })
  }

  // - MARK: Private functions

  private getUserFriends = async () => {
    const res = await this.fetch({ method: 'GET', url: 'users/@me/relationships' })
    if (!res.body) throw new Error('No response')
    this.userFriends = JSON.parse(res.body).filter(f => f.type === 1) // Only friends
      .map(f => mapUser(f.user))
  }

  private setupGatewayListeners = () => {
    texts.log('Connecting to gateway...')

    this.client.on('ready', () => {
      texts.log('Connected to gateway.')
      this.client.user?.setStatus('online')
      this.ready = true
    })
    this.client.on('disconnect', () => {
      texts.log('Disconnected from gateway.')
      this.ready = false
    })
    this.client.on('invalidated', () => {
      texts.log('Gateway connection invalidated')
      this.ready = false

      if (RESTART_ON_FAIL) this.client.login(this.token, false)
    })
    this.client.on('error', error => {
      texts.error('Gateway error:' + error)
      this.ready = false

      if (RESTART_ON_FAIL) this.client.login(this.token, false)
      throw error
    })
    this.client.on('warn', warning => {
      texts.log('Gateway warning: ' + warning)
    })
    this.client.on('webhookUpdate', update => {
      texts.log('Webhook update: ' + update)
    })

    this.client.on('message', msg => {
      if (msg.guild) return
      if (this.eventCallback) this.eventCallback([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: msg.channel.id }])
    })
    this.client.on('messageUpdate', msg => {
      if (msg.guild) return
      if (this.eventCallback) this.eventCallback([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: msg.channel.id }])
    })
    this.client.on('messageDelete', msg => {
      if (msg.guild) return
      if (this.eventCallback) this.eventCallback([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: msg.channel.id }])
    })
    this.client.on('messageDeleteBulk', msgs => {
      if (this.eventCallback) this.eventCallback(msgs.filter(m => !m.guild).map(m => ({ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: m.channel.id })))
    })
    this.client.on('messageReactionAdd', reaction => {
      if (reaction.message.guild) return
      if (this.eventCallback) this.eventCallback([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: reaction.message.channel.id }])
    })
    this.client.on('messageReactionRemove', reaction => {
      if (reaction.message.guild) return
      if (this.eventCallback) this.eventCallback([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: reaction.message.channel.id }])
    })
    this.client.on('messageReactionRemoveEmoji', reaction => {
      if (reaction.message.guild) return
      if (this.eventCallback) this.eventCallback([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: reaction.message.channel.id }])
    })
    this.client.on('messageReactionRemoveAll', msg => {
      if (msg.guild) return
      if (this.eventCallback) this.eventCallback([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: msg.channel.id }])
    })
    this.client.on('presenceUpdate', (_, presence) => {
      if (presence.guild) return
      if (this.eventCallback) this.eventCallback([{ type: ServerEventType.USER_PRESENCE_UPDATED, presence: { userID: presence.userID, isActive: presence.status === 'online' || presence.status === 'idle', lastActive: new Date() } }])
    })
    this.client.on('typingStart', (channel, user) => {
      if (channel.type !== 'dm' && channel.type !== 'group') return
      if (this.eventCallback) this.eventCallback([{ type: ServerEventType.PARTICIPANT_TYPING, typing: user.typingIn(channel.id), participantID: user.id, threadID: channel.id }])
    })
    this.client.on('userUpdate', (_, user) => {
      if (this.eventCallback) this.eventCallback([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: user.id }])
    })
    this.client.on('channelCreate', channel => {
      if (channel.type !== 'dm' && channel.type !== 'group') return
      if (this.eventCallback) this.eventCallback([{ type: ServerEventType.STATE_SYNC, mutationType: 'upsert', objectName: 'thread', objectIDs: { threadID: channel.id }, entries: [{ id: channel.id, isUnread: true }] }])
    })
    this.client.on('channelDelete', channel => {
      if (channel.type !== 'dm' && channel.type !== 'group') return
      if (this.eventCallback) this.eventCallback([{ type: ServerEventType.STATE_SYNC, mutationType: 'update', objectName: 'thread', objectIDs: { threadID: channel.id }, entries: [{ id: channel.id, isUnread: true }] }])
    })
    this.client.on('channelUpdate', (_, channel) => {
      if (channel.type !== 'dm' && channel.type !== 'group') return
      if (this.eventCallback) this.eventCallback([{ type: ServerEventType.STATE_SYNC, mutationType: 'update', objectName: 'participant', objectIDs: { threadID: channel.id }, entries: [{ id: channel.id, isUnread: true }] }])
    })
    this.client.on('relationshipAdd', (_, relation) => {
      console.log('relationshipAdd')
    })
    this.client.on('rateLimit', limit => {
      texts.log('We\'re being ratelimited: ' + limit.limit, limit.timeout)
    })
  }

  private fetch = async ({ headers = {}, ...rest }) => {
    try {
      const res = await got({
        throwHttpErrors: false,
        prefixUrl: API_ENDPOINT,
        headers: {
          'User-Agent': `DiscordBot (${VERSION})`,
          'Accept-Encoding': 'gzip, deflate, br',
          Authorization: this.token,
          ...headers,
        },
        ...rest,
      })

      if (res.body && JSON.parse(res.body)) handleErrors(JSON.parse(res.body))
      return res
    } catch (err) {
      if (err.code === 'ECONNREFUSED' && (err.message.endsWith('0.0.0.0:443') || err.message.endsWith('127.0.0.1:443'))) {
        texts.error('Discord is blocked')
        throw new Error('Discord seems to be blocked on your device. This could have been done by an app or a manual entry in /etc/hosts')
      }
      throw err
    }
  }
}
