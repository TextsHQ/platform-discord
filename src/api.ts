import { PlatformAPI, OnServerEventCallback, LoginResult, Paginated, Message, InboxName, MessageContent, PaginationArg, ActivityType, MessageSendOptions, texts, LoginCreds, Thread, AccountInfo, ServerEventType } from '@textshq/platform-sdk'
import DiscordNetworkAPI from './network-api'

export const getDataURI = (buffer: Buffer, mimeType: string = '') => `data:${mimeType};base64,${buffer.toString('base64')}`

const POLLING_INTERVAL = 10_000

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

  getCurrentUser = () => this.api.getCurrentUser()

  login = async ({ jsCodeResult }: LoginCreds): Promise<LoginResult> => {
    if (!jsCodeResult) return { type: 'error', errorMessage: 'Token was empty' }
    await this.api.login(jsCodeResult)
    return { type: 'success' }
  }

  logout = () => this.api.logout()

  serializeSession = () => this.api.token

  subscribeToEvents = (onEvent: OnServerEventCallback) => {
    this.api.eventCallback = onEvent
  }

  searchUsers = (typed: string) => {
    const typedLower = typed.toLowerCase()
    return typed ? this.api.userFriends.filter(u => u.username.toLowerCase().includes(typedLower)) : this.api.userFriends
  }

  // TODO: Implement searchMessages
  /* searchMessages = async (typed: string, pagination?: PaginationArg, threadID?: string) => {
  } */

  getPresence = () => this.api.getUsersPresence()

  getThreads = (inboxName: InboxName, pagination?: PaginationArg) => this.api.getThreads(inboxName, pagination)

  getMessages = async (threadID: string, pagination?: PaginationArg): Promise<Paginated<Message>> => {
    const items = await this.api.getMessages(threadID, pagination)
    return { items, hasMore: items.length > 0 }
  }

  createThread = (userIDs: string[], title?: string) => this.api.createThread(userIDs, title)

  updateThread = (threadID: string, updates: Partial<Thread>) => {
    if ('title' in updates) return this.api.patchChannel(threadID, { name: updates.title })
  }

  changeThreadImage = async (threadID: string, imageBuffer: Buffer, mimeType: string) => {
    await this.api.patchChannel(threadID, { icon: getDataURI(imageBuffer, mimeType) })
  }

  deleteThread = (threadID: string) => this.api.closeThread(threadID)

  reportThread = async (type: 'spam', threadID: string, firstMessageID: string) => this.api.reportThread(threadID, firstMessageID)

  sendMessage = (threadID: string, content: MessageContent, options?: MessageSendOptions) => this.api.sendMessage(threadID, content, options)

  editMessage = (threadID: string, messageID: string, content: MessageContent, options?: MessageSendOptions) => this.api.editMessage(threadID, messageID, content, options)

  deleteMessage = (threadID: string, messageID: string, forEveryone?: boolean) => this.api.deleteMessage(threadID, messageID, forEveryone)

  addReaction = (threadID: string, messageID: string, reactionKey: string) => this.api.addReaction(threadID, messageID, reactionKey)

  removeReaction = (threadID: string, messageID: string, reactionKey: string) => this.api.removeReaction(threadID, messageID, reactionKey)

  sendActivityIndicator = (type: ActivityType, threadID: string) => this.api.setTyping(type, threadID)

  sendReadReceipt = (threadID: string, messageID: string) => {
    if (!messageID) {
      const ogThreadJSON = texts.getOriginalObject('discord', this.accountID, ['thread', threadID])
      const ogThread = JSON.parse(ogThreadJSON)
      // eslint-disable-next-line no-param-reassign
      messageID = ogThread.last_message_id
    }
    return this.api.sendReadReceipt(threadID, messageID)
  }

  onThreadSelected = async (threadID: string) => this.api.onThreadSelected(threadID)

  onResumeFromSleep = async () => {
    texts.log('[discord] Resumed from sleep')
    await this.api.connect(true)
    this.api.eventCallback([{ type: ServerEventType.THREAD_MESSAGES_REFRESH_ALL }])
  }

  startPolling = async () => {
    texts.log(`[discord] Starting polling, interval: ${POLLING_INTERVAL}`)

    const action = async () => {
      texts.log('[discord] Polling...')
      try {
        const user = await this.api.getCurrentUser()
        if (user) {
          texts.log('[discord] Poll successful!')
          await this.stopPolling()
        }
      } catch (error) {
        texts.log('[discord] Poll failed!', error)
      }
    }
    this.pollingInterval = setInterval(action, POLLING_INTERVAL)
    await action()
  }

  stopPolling = async () => {
    if (!this.pollingInterval) return
    texts.log('[discord] Stopping polling')

    clearInterval(this.pollingInterval)
    this.pollingInterval = null

    await this.api.connect(true)
    this.api.eventCallback([{ type: ServerEventType.THREAD_MESSAGES_REFRESH_ALL }])
  }
}
