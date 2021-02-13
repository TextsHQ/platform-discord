import { CookieJar } from 'tough-cookie'
import { PlatformAPI, OnServerEventCallback, LoginResult, Paginated, Thread, Message, InboxName, MessageContent, PaginationArg, OnConnStateChangeCallback, ActivityType, MessageSendOptions } from '@textshq/platform-sdk'
import DiscordAPI from './network-api'

export default class Discord implements PlatformAPI {
  private api: DiscordAPI = new DiscordAPI()

  init = async (cookieJarJSON: any) => {
    if (!cookieJarJSON) return
    const cookieJar = CookieJar.fromJSON(cookieJarJSON)
    await this.api.login(cookieJar)
  }

  dispose = async () => this.api.logout()

  login = async (creds): Promise<LoginResult> => {
    if (!creds.cookieJarJSON) return { type: 'error' }
    await this.api.login(CookieJar.fromJSON(creds.cookieJarJSON as any))
    return { type: 'success' }
  }

  logout = async () => this.api.logout()

  serializeSession = () => this.api.cookieJar.toJSON()

  subscribeToEvents = (onEvent: OnServerEventCallback) => {
    this.api.eventCallback = onEvent
    this.poll()
  }

  onConnectionStateChange = async (onEvent: OnConnStateChangeCallback): Promise<void> => {
    this.api.connectionStateChangeCallback = onEvent
  }

  poll = async () => { }

  getCurrentUser = async () => this.api.getCurrentUser()

  searchUsers = async (typed: string) => this.api.userFriends.filter(u => u.username.toLowerCase().includes(typed.toLowerCase()))

  // getPresence = async () => this.api.getUsersPresence()

  getThreads = async (inboxName: InboxName, pagination?: PaginationArg): Promise<Paginated<Thread>> => this.api.getThreads(inboxName, pagination)

  createThread = (userIDs: string[], title?: string) => this.api.createThread(userIDs, title)

  archiveThread = (threadID: string) => this.api.archiveThread(threadID)

  getMessages = async (threadID: string, pagination?: PaginationArg): Promise<Paginated<Message>> => {
    // TODO: Check if there's more messages
    return { items: await this.api.getMessages(threadID, pagination), hasMore: true }
  }

  sendMessage = async (threadID: string, content: MessageContent, options?: MessageSendOptions) => this.api.sendMessage(threadID, content, options)

  deleteMessage = async (threadID: string, messageID: string, forEveryone?: boolean) => this.api.deleteMessage(threadID, messageID, forEveryone)

  addReaction = async (threadID: string, messageID: string, reactionKey: string) => this.api.addReaction(threadID, messageID, reactionKey)

  removeReaction = async (threadID: string, messageID: string, reactionKey: string) => this.api.removeReaction(threadID, messageID, reactionKey)

  sendActivityIndicator = async (type: ActivityType, threadID: string) => this.api.setTyping(type, threadID)

  sendReadReceipt = async (threadID: string, messageID: string) => this.api.sendReadReceipt(threadID, messageID)
}
