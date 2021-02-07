import { CookieJar } from 'tough-cookie'
import { PlatformAPI, OnServerEventCallback, LoginResult, Paginated, Thread, Message, CurrentUser, InboxName, MessageContent, PaginationArg } from '@textshq/platform-sdk'
import DiscordAPI from './network-api'

export default class Discord implements PlatformAPI {
  private api?: DiscordAPI

  eventCallback: OnServerEventCallback

  init = async (cookieJarJSON?: CookieJar.Serialized) => {
    if (!cookieJarJSON) return
    const cookie = cookieJarJSON.cookies.find(c => c.key === 'token')

    if (!cookie.value) {
      return
    }

    if (!this.api) {
      this.api = new DiscordAPI(cookie.value)
    }
  }

  login = async (creds): Promise<LoginResult> => {
    if (!creds.cookieJarJSON) return { type: 'error' }
    const cookie = creds.cookieJarJSON.cookies.find(c => c.key === 'token')

    if (!cookie.value) {
      return { type: 'error' }
    }

    if (!this.api) {
      this.api = new DiscordAPI(cookie.value)
    }
    return { type: 'success' }
  }

  getCurrentUser = async (): Promise<CurrentUser> => {
    if (!this.api) {
      throw new Error('No DiscordAPI initialized.')
    }
    return this.api.getCurrentUser()
  }

  subscribeToEvents = (onEvent: OnServerEventCallback) => {
    this.eventCallback = onEvent
    this.poll()
  }

  poll = async () => { }

  dispose = () => { }

  searchUsers = async (typed: string) => []

  createThread = (userIDs: string[]) => null as any

  getThreads = async (inboxName: InboxName, pagination?: PaginationArg): Promise<Paginated<Thread>> => {
    if (!this.api) {
      throw new Error('No DiscordAPI initialized.')
    }

    return { items: await this.api.getThreads(), hasMore: false }
  }

  getMessages = async (threadID: string, pagination?: PaginationArg): Promise<Paginated<Message>> => {
    return { items: [], hasMore: false }
  }

  sendMessage = async (threadID: string, content: MessageContent) => {
    if (!this.api) {
      throw new Error('No DiscordAPI initialized.')
    }
    return this.api.sendMessage(threadID, content)
  }

  sendActivityIndicator = (threadID: string) => { }

  sendReadReceipt = async (threadID: string, messageID: string) => { }
}
