import { CookieJar } from 'tough-cookie'
import { PlatformAPI, OnServerEventCallback, LoginResult, Paginated, Message, InboxName, MessageContent, PaginationArg, OnConnStateChangeCallback, ActivityType, MessageSendOptions, texts } from '@textshq/platform-sdk'
import DiscordAPI from './network-api'

export default class Discord implements PlatformAPI {
  private api: DiscordAPI = new DiscordAPI()

  private pollingInterval?: NodeJS.Timeout

  init = async (cookieJarJSON: any) => {
    if (!cookieJarJSON) return
    const cookieJar = CookieJar.fromJSON(cookieJarJSON)
    await this.api.login(cookieJar)

    this.api.startPolling = this.startPolling
    this.api.stopPolling = this.stopPolling
  }

  dispose = () => this.api.dispose()

  login = async (creds): Promise<LoginResult> => {
    if (!creds.cookieJarJSON) return { type: 'error' }
    await this.api.login(CookieJar.fromJSON(creds.cookieJarJSON as any))
    return { type: 'success' }
  }

  logout = () => this.api.logout()

  startPolling = async () => {
    if (this.pollingInterval) return

    texts.log('Starting polling')
    this.api.ready = false

    this.pollingInterval = setInterval(async () => {
      const currentUser = await this.api.getCurrentUser()
      if (currentUser) this.stopPolling()
    }, 10_000)
  }

  stopPolling = () => {
    if (this.pollingInterval) {
      texts.log('Stopping polling')
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
      this.api.ready = true
      this.api.setupWebsocket()
      this.api.refresh()
    }
  }

  serializeSession = () => this.api.cookieJar.toJSON()

  subscribeToEvents = (onEvent: OnServerEventCallback) => {
    this.api.eventCallback = onEvent
  }

  getCurrentUser = () => this.api.getCurrentUser()

  searchUsers = (typed: string) => this.api.userFriends.filter(u => u.username.toLowerCase().includes(typed.toLowerCase()))

  getPresence = () => this.api.getUsersPresence()

  getThreads = (inboxName: InboxName, pagination?: PaginationArg) => this.api.getThreads(inboxName, pagination)

  createThread = (userIDs: string[], title?: string) => this.api.createThread(userIDs, title)

  archiveThread = (threadID: string) => this.api.archiveThread(threadID)

  getMessages = async (threadID: string, pagination?: PaginationArg): Promise<Paginated<Message>> => {
    // TODO: Check if there's more messages
    return { items: await this.api.getMessages(threadID, pagination), hasMore: true }
  }

  sendMessage = (threadID: string, content: MessageContent, options?: MessageSendOptions) => this.api.sendMessage(threadID, content, options)

  editMessage = (threadID: string, messageID: string, content: MessageContent, options?: MessageSendOptions) => this.api.editMessage(threadID, messageID, content, options)

  deleteMessage = (threadID: string, messageID: string, forEveryone?: boolean) => this.api.deleteMessage(threadID, messageID, forEveryone)

  addReaction = (threadID: string, messageID: string, reactionKey: string) => this.api.addReaction(threadID, messageID, reactionKey)

  removeReaction = (threadID: string, messageID: string, reactionKey: string) => this.api.removeReaction(threadID, messageID, reactionKey)

  sendActivityIndicator = (type: ActivityType, threadID: string) => this.api.setTyping(type, threadID)

  sendReadReceipt = (threadID: string, messageID: string) => this.api.sendReadReceipt(threadID, messageID)
}
