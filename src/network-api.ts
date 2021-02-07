import { texts, CurrentUser, MessageContent, PaginationArg, Thread, Message as TextsMessage, InboxName } from '@textshq/platform-sdk'
import { Client as DiscordClient, Message as DiscordMessage } from 'better-discord.js'
import { mapCurrentUser, mapMessage, mapThread } from './mappers'
import { DISCORD_ERROR } from './errors'

const got = require('got')

const API_ENDPOINT = 'https://discord.com/api/v8'
const LIMIT_COUNT = 25

function handleErrors(json: any): boolean {
  if (json.code && DISCORD_ERROR[json.code]) {
    throw DISCORD_ERROR[json.code]
  }

  return true
}

export default class DiscordAPI {
  private token: string

  private readonly client: DiscordClient = new DiscordClient()

  public currentUserID?: string

  public ready: boolean = false

  // MARK: - constructor

  constructor(token: string) {
    this.token = token
    this.client.login(token, false)
    this.setupGatewayListeners()
  }

  // MARK: - Public functions

  public getCurrentUser = async (): Promise<CurrentUser> => {
    const json = await this.fetch({ method: 'GET', url: `${API_ENDPOINT}/users/@me` })
    if (!json) throw new Error('No response')

    const currentUser: CurrentUser = mapCurrentUser(json)
    this.currentUserID = currentUser.id

    return currentUser
  }

  public getThreads = async (inboxName: InboxName, pagination?: PaginationArg): Promise<Thread[]> => {
    const json = await this.fetch({ method: 'GET', url: `${API_ENDPOINT}/users/@me/channels` })
    if (!json) throw new Error('No response')

    let limit: number = 0
    return json.map(async thread => {
      const lastMessage: string = limit <= LIMIT_COUNT ? (await this.fetch({ method: 'GET', url: `https://discord.com/api/v8/channels/${thread.id}/messages?limit=1` })).content : ''
      limit++

      return mapThread(thread, lastMessage)
    })
  }

  public getMessages = async (threadID: string, pagination?: PaginationArg): Promise<TextsMessage[]> => {
    const json = await this.fetch({ method: 'GET', url: `${API_ENDPOINT}/channels/${threadID}/messages?limit=${LIMIT_COUNT}` })
    if (!json) throw new Error('No response')
    return json.map(mapMessage)
  }

  public sendMessage = async (threadID: string, content: MessageContent): Promise<boolean> => {
    const user = this.client.users.cache.get(threadID)
    if (!user) {
      texts.log(`User with ID ${threadID} not found.`)
      return false
    }

    while (!this.ready) await new Promise(resolve => setTimeout(resolve, 1000))

    if (!this.ready) {
      texts.log('Client not ready')
      return false
    }

    if (content.text) {
      user.send(content.text)
      return true
    }

    return false
  }

  // - MARK: Private functions

  private messageHandler = (message: DiscordMessage) => {
    // Ignore messages from guilds - they're not DMs, so we don't care 🤷‍♂️
    if (message.guild) {
      return
    }

    console.log(message.content)
  }

  private setupGatewayListeners = () => {
    texts.log('Connecting to gateway...')

    this.client.on('ready', () => {
      texts.log('Connected to gateway.')
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
      texts.log('messageDelete')
    })
    this.client.on('messageDeleteBulk', msgs => {
      texts.log('messageDeleteBulk')
    })
    this.client.on('messageReactionAdd', (reaction, user) => {
      texts.log('messageReactionAdd')
    })
    this.client.on('messageReactionRemove', (reaction, user) => {
      texts.log('messageReactionRemove')
    })
    this.client.on('messageReactionRemoveAll', reactions => {
      texts.log('messageReactionRemoveAll ' + reactions)
    })
    this.client.on('messageReactionRemoveEmoji', reactionEmoji => {
      texts.log('messageReactionRemoveEmoji ' + reactionEmoji)
    })
    this.client.on('messageUpdate', (msg1, msg2) => {
      texts.log('messageUpdate ' + msg1 + msg2)
    })
    this.client.on('presenceUpdate', (presence1, presence2) => {
      texts.log('presenceUpdate')
    })
    this.client.on('rateLimit', limit => {
      texts.log('rateLimit ' + limit)
    })
    this.client.on('typingStart', (channel, user) => {
      texts.log('typingStart')
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
        console.error('Discord is blocked')
        throw new Error('Discord seems to be blocked on your device. This could have been done by an app or a manual entry in /etc/hosts')
      }
      throw err
    }
  }
}
