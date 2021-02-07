import { CurrentUser, MessageContent, texts, Thread } from '@textshq/platform-sdk'
import { Client as DiscordClient, Message } from 'better-discord.js'
import { mapCurrentUser, mapThread } from './mappers'
import { DISCORD_ERROR } from './errors'

const got = require('got')

function handleErrors(json: any): boolean {
  if (json.code && DISCORD_ERROR[json.code]) {
    throw DISCORD_ERROR[json.code]
  }

  return false
}

export default class DiscordAPI {
  private token: string

  private readonly client: DiscordClient = new DiscordClient()

  public currentUserID?: string

  public ready: boolean = false

  // MARK: - constructor
  constructor(token: string) {
    this.token = token
    this.client.login(token)
    this.setupGatewayListeners()
  }

  // MARK: - Public functions

  public getCurrentUser = async (): Promise<CurrentUser> => {
    const json = await this.fetch({ method: 'GET', url: 'https://discord.com/api/v8/users/@me' })
    if (!json) throw new Error('No response')

    const currentUser: CurrentUser = mapCurrentUser(json)
    this.currentUserID = currentUser.id

    return currentUser
  }

  public getThreads = async (): Promise<Thread[]> => {
    const json = await this.fetch({ method: 'GET', url: 'https://discord.com/api/v8/users/@me/channels' })
    if (!json) throw new Error('No response')
    return json.map(thread => {
      // const lastMessage = await this.fetch({ method: 'GET', url: `https://discord.com/api/v8/channels/${thread.id}/messages?limit=1` })
      return mapThread(thread, 'asd')
    })
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
  private fetch = async ({ headers = {}, ...rest }) => {
    try {
      const res = await got({
        throwHttpErrors: false,
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
        throw Error('Discord seems to be blocked on your device. This could have been done by an app or a manual entry in /etc/hosts')
      }
      throw err
    }
  }

  private setupGatewayListeners = () => {
    texts.log('Connecting to gateway.')
    this.client.on('message', this.messageHandler)
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
      texts.error('Gateway connection error:' + error)
    })
  }

  private messageHandler = (message: Message) => {
    // Ignore messages from guilds (other servers)
    if (message.guild) {
      return
    }

    console.log(message.content)
  }
}
