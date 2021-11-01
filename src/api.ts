import { PlatformAPI, OnServerEventCallback, LoginResult, Paginated, Message, InboxName, MessageContent, PaginationArg, ActivityType, MessageSendOptions, texts, LoginCreds, Thread, AccountInfo } from '@textshq/platform-sdk'
import DiscordNetworkAPI from './network-api'

export const getDataURI = (buffer: Buffer, mimeType: string = '') =>
  `data:${mimeType};base64,${buffer.toString('base64')}`

export default class Discord implements PlatformAPI {
  private accountID: string

  private api = new DiscordNetworkAPI()

  private pollingInterval?: NodeJS.Timeout

  init = async (session: any, { accountID }: AccountInfo) => {
    this.accountID = accountID
    if (!session) return
    await this.api.login(session)

    this.api.startPolling = this.startPolling
    this.api.stopPolling = this.stopPolling
  }

  dispose = () => this.api.dispose()

  login = async ({ jsCodeResult }: LoginCreds): Promise<LoginResult> => {
    if (!jsCodeResult) return { type: 'error', errorMessage: 'Token was empty' }
    await this.api.login(jsCodeResult)
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
    if (!this.pollingInterval) return
    texts.log('Stopping polling')
    clearInterval(this.pollingInterval)
    this.pollingInterval = null
    this.api.ready = true
    this.api.setupWebsocket()
    // this.api.refresh()
  }

  serializeSession = () => this.api.token

  subscribeToEvents = (onEvent: OnServerEventCallback) => {
    this.api.eventCallback = onEvent
  }

  getCurrentUser = () => this.api.getCurrentUser()

  searchUsers = (typed: string) => {
    const typedLower = typed.toLowerCase()
    return typed ? this.api.userFriends.filter(u => u.username.toLowerCase().includes(typedLower)) : this.api.userFriends
  }

  getPresence = () => this.api.getUsersPresence()

  getThreads = (inboxName: InboxName, pagination?: PaginationArg) =>
    this.api.getThreads(inboxName, pagination)

  createThread = (userIDs: string[], title?: string) =>
    this.api.createThread(userIDs, title)

  archiveThread = (threadID: string) =>
    this.api.archiveThread(threadID)

  reportThread = async (type: 'spam', threadID: string, firstMessageID: string) =>
    this.api.reportThread(threadID, firstMessageID)

  getMessages = async (threadID: string, pagination?: PaginationArg): Promise<Paginated<Message>> => {
    const items = await this.api.getMessages(threadID, pagination)
    return { items, hasMore: items.length > 0 }
  }

  sendMessage = (threadID: string, content: MessageContent, options?: MessageSendOptions) =>
    this.api.sendMessage(threadID, content, options)

  editMessage = (threadID: string, messageID: string, content: MessageContent, options?: MessageSendOptions) =>
    this.api.editMessage(threadID, messageID, content, options)

  deleteMessage = (threadID: string, messageID: string, forEveryone?: boolean) =>
    this.api.deleteMessage(threadID, messageID, forEveryone)

  addReaction = (threadID: string, messageID: string, reactionKey: string) =>
    this.api.addReaction(threadID, messageID, reactionKey)

  removeReaction = (threadID: string, messageID: string, reactionKey: string) =>
    this.api.removeReaction(threadID, messageID, reactionKey)

  sendActivityIndicator = (type: ActivityType, threadID: string) =>
    this.api.setTyping(type, threadID)

  sendReadReceipt = (threadID: string, messageID: string) => {
    if (!messageID) {
      const ogThreadJSON = texts.getOriginalObject('discord', this.accountID, ['thread', threadID])
      const ogThread = JSON.parse(ogThreadJSON)
      // eslint-disable-next-line no-param-reassign
      messageID = ogThread.last_message_id
    }
    return this.api.sendReadReceipt(threadID, messageID)
  }

  updateThread = (threadID: string, updates: Partial<Thread>) => {
    if ('title' in updates) return this.api.patchChannel(threadID, { name: updates.title })
  }

  changeThreadImage = async (threadID: string, imageBuffer: Buffer, mimeType: string) => {
    await this.api.patchChannel(threadID, { icon: getDataURI(imageBuffer, mimeType) })
  }

  getCustomEmojis = () => this.api.getCustomEmojis()

  onThreadSelected = async (threadID: string) => this.api.onThreadSelected(threadID)
}
