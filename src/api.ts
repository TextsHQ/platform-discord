import { CookieJar } from 'tough-cookie'
import { PlatformAPI, OnServerEventCallback, LoginResult, Paginated, Thread, Message, CurrentUser, InboxName, MessageContent, PaginationArg } from '@textshq/platform-sdk'
import DiscordAPI from './network-api'

const sleep = (s: number) => new Promise(resolve => setTimeout(resolve, s))

export default class Discord implements PlatformAPI {
  private eventLoopRunning = true

  private eventCallback: OnServerEventCallback

  private threads: Thread[] = []

  private discordAPI: DiscordAPI = new DiscordAPI()

  init = () => { }

  login = async (creds): Promise<LoginResult> => {
    if (!creds.cookieJarJSON) return { type: 'error' }
    const cookie = creds.cookieJarJSON.cookies.find(c => c.key === 'token')

    if (!cookie.value) {
      return { type: 'error' }
    }

    this.discordAPI.setToken(cookie.value)
    return { type: 'success' }
  }

  logout = () => { }

  getCurrentUser = async (): Promise<CurrentUser> => {
    return this.discordAPI.getCurrentUser()
  }

  subscribeToEvents = (onEvent: OnServerEventCallback) => {
    this.eventCallback = onEvent
    this.poll()
  }

  poll = async () => {
    while (this.eventLoopRunning) {
      /* const { messages } = await discordAPI(`http://localhost:3000/${this.token}`);

      (messages as Message[]).forEach(msg => {
        if (!seenEvents.has(msg.id)) {
          this.eventCallback([{
            type: ServerEventType.THREAD_MESSAGES_REFRESH,
            threadID: '123',
          }])
          seenEvents.add(msg.id)
        }
      }) */

      await sleep(2000)
    }
  }

  dispose = () => {
    this.eventLoopRunning = false
  }

  serializeSession = () => { }

  searchUsers = async (typed: string) => []

  createThread = (userIDs: string[]) => null as any

  getThreads = async (inboxName: InboxName, pagination?: PaginationArg): Promise<Paginated<Thread>> => {
    const { cursor } = pagination || {}
    const idx = cursor ? (+cursor || 0) : 0
    const items = this.threads // .slice(idx, idx + 25)
    return {
      items,
      hasMore: items.length >= 25,
      oldestCursor: (idx + 25).toString(),
    }
  }

  getMessages = async (threadID: string, pagination?: PaginationArg): Promise<Paginated<Message>> => {
    return { items: [], hasMore: false }
    /* const { messages } = await discordAPI('http://localhost:3000/api/messages?cursor=' + (pagination?.cursor || ''))
    const items = messages.map(msg => ({
      ...msg,
      timestamp: new Date(msg.timestamp),
    }))
    return {
      items,
      hasMore: items.length === 10,
    } */
  }

  sendMessage = async (threadID: string, content: MessageContent) => {
    /* await discordAPI('http://localhost:3000/api/messages', {
      method: 'post',
      body: {
        ...content,
        threadID,
        senderID: 'test-user', // TODO: figure this out
      },
    }) */

    return false
  }

  sendActivityIndicator = (threadID: string) => { }

  addReaction = async (threadID: string, messageID: string, reactionKey: string) => { }

  removeReaction = async (threadID: string, messageID: string, reactionKey: string) => { }

  deleteMessage = async (threadID: string, messageID: string) => true

  sendReadReceipt = async (threadID: string, messageID: string) => { }
}
