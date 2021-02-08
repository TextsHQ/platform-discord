import { CookieJar } from 'tough-cookie'
import { texts, CurrentUser, MessageContent, PaginationArg, Thread, Message as TextsMessage, InboxName, PlatformAPI, ServerEventType, OnServerEventCallback, User } from '@textshq/platform-sdk'
import { Client as DiscordClient, DMChannel, Message as DiscordMessage } from 'better-discord.js'
import { mapCurrentUser, mapMessage, mapThread } from './mappers'
import { DISCORD_ERROR } from './errors'

const got = require('got')

const API_ENDPOINT = 'https://discord.com/api/v8'
const LIMIT_COUNT = 25
const WAIT_TILL_READY = true

function handleErrors(json: any): boolean {
  if (json.code && DISCORD_ERROR[json.code]) {
    throw DISCORD_ERROR[json.code]
  }

  return true
}

async function sleep(time: number) {
  return new Promise(resolve => setTimeout(resolve, time))
}

export default class DiscordAPI {
  private token?: string

  private readonly client: DiscordClient = new DiscordClient()

  public cookieJar?: CookieJar

  public currentUser: User

  public eventCallback?: OnServerEventCallback

  public ready: boolean = false

  // MARK: - Public functions

  public setLoginState = async (cookieJar: CookieJar) => {
    if (!cookieJar) throw TypeError()
    this.cookieJar = cookieJar

    const cookies = this.cookieJar.getCookiesSync('https://discord.com')
    this.token = cookies.find(c => c.key === 'token')?.value

    if (!this.token) throw new Error('No token found.')

    this.client.login(this.token, false)
    this.setupGatewayListeners()
  }

  public getCurrentUser = async (): Promise<CurrentUser> => {
    const json = await this.fetch({ method: 'GET', url: `${API_ENDPOINT}/users/@me` })
    if (!json) throw new Error('No response')

    const currentUser: CurrentUser = mapCurrentUser(json)
    this.currentUser = currentUser

    return currentUser
  }

  public getThreads = async (inboxName: InboxName, pagination?: PaginationArg): Promise<Thread[]> => {
    const json = await this.fetch({ method: 'GET', url: `${API_ENDPOINT}/users/@me/channels` })
    if (!json) throw new Error('No response')

    return Promise.all(json.map(async thread => {
      const lastMessage = await this.fetch({ method: 'GET', url: `https://discord.com/api/v8/channels/${thread.id}/messages?limit=1` })
      return mapThread(thread, this.currentUser, (lastMessage.length > 0 ? lastMessage[0] : undefined))
    }))
  }

  public getMessages = async (threadID: string, pagination?: PaginationArg): Promise<TextsMessage[]> => {
    if (!this.currentUser) throw new Error('No current user')

    while (!this.ready && WAIT_TILL_READY) await sleep(1000)

    const channel: DMChannel = await this.client.channels.fetch(threadID) as DMChannel
    if (!channel) throw new Error('Channel not found!')

    const messages = await channel.messages.fetch()
    return messages
      .map(m => mapMessage(m, this.currentUser.id))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }

  public sendMessage = async (threadID: string, content: MessageContent): Promise<boolean> => {
    const channel: DMChannel = await this.client.channels.fetch(threadID) as DMChannel
    if (!channel) throw new Error('Thread with ID ' + threadID + ' not found!')
    while (!this.ready && WAIT_TILL_READY) await sleep(1000)

    await channel.send(content.text, {
      files: content.fileName && content.filePath ? [{
        attachment: content.filePath,
        name: content.fileName,
      }] : undefined,
    })

    return true
  }

  // - MARK: Private functions

  private messageHandler = (message: DiscordMessage) => {
    // Ignore messages from guilds - they're not DMs, so we don't care 🤷‍♂️
    if (message.guild) return

    // Ignore empty messages
    if (!message.content && !message.embeds) return

    if (this.eventCallback) this.eventCallback([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: message.channel.id }])
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
    })
    this.client.on('error', error => {
      texts.error('Gateway error:' + error)
      this.ready = false
      throw error
    })
    this.client.on('warn', warning => {
      texts.log('Gateway warning: ' + warning)
    })

    this.client.on('message', this.messageHandler)
    this.client.on('messageDelete', msg => {
      if (msg.guild) return
      texts.log('messageDelete')
    })
    this.client.on('messageDeleteBulk', msgs => {
      const messages = msgs.filter(m => !m.guild)
      texts.log('messageDeleteBulk')
    })
    this.client.on('messageReactionAdd', reaction => {
      if (reaction.message.guild) return
      if (this.eventCallback) this.eventCallback([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: reaction.message.id }])
    })
    this.client.on('messageReactionRemove', reaction => {
      if (reaction.message.guild) return
      if (this.eventCallback) this.eventCallback([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: reaction.message.id }])
    })
    this.client.on('messageReactionRemoveAll', reactions => {
      if (reactions.guild) return
      texts.log('messageReactionRemoveAll ' + reactions)
    })
    this.client.on('messageReactionRemoveEmoji', reactionEmoji => {
      if (reactionEmoji.message.guild) return
      if (this.eventCallback) this.eventCallback([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: reactionEmoji.message.id }])
    })
    this.client.on('messageUpdate', (msg1, msg2) => {
      if (msg1.guild || msg2.guild) return
      if (this.eventCallback) this.eventCallback([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: msg1.channel.id }])
    })
    this.client.on('presenceUpdate', (presence1, presence2) => {
      if (presence1?.guild || presence2.guild) return

      texts.log('presenceUpdate', presence1, presence2)
    })
    this.client.on('rateLimit', limit => {
      texts.log('We\'re being ratelimited: ' + limit)
    })
    this.client.on('typingStart', (channel, user) => {
      if (channel.type !== 'dm' && channel.type !== 'group') return
      if (this.eventCallback) this.eventCallback([{ type: ServerEventType.PARTICIPANT_TYPING, typing: user.typingIn(channel.id), participantID: user.id, threadID: channel.id }])
    })
    this.client.on('userUpdate', (user1, user2) => {
      texts.log('userUpdate')
    })
  }

  private fetch = async ({ headers = {}, ...rest }) => {
    try {
      const res = await got({
        throwHttpErrors: true,
        headers: {
          Authorization: this.token,
          ...headers,
        },
        ...rest,
      })

      if (!res.body) return

      const json = JSON.parse(res.body)
      if (!handleErrors(json)) {
        return
      }
      return json
    } catch (err) {
      if (err.code === 'ECONNREFUSED' && (err.message.endsWith('0.0.0.0:443') || err.message.endsWith('127.0.0.1:443'))) {
        texts.error('Discord is blocked')
        throw new Error('Discord seems to be blocked on your device. This could have been done by an app or a manual entry in /etc/hosts')
      }
      throw err
    }
  }
}
