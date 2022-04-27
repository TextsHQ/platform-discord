import { PlatformAPI, OnServerEventCallback, LoginResult, Paginated, Message, MessageContent, PaginationArg, ActivityType, MessageSendOptions, texts, LoginCreds, Thread, AccountInfo, ServerEventType } from '@textshq/platform-sdk'
import DiscordNetworkAPI from './network-api'
import { getDataURI } from './util'

const POLLING_INTERVAL = 10_000
const LOG_PREFIX = '[discord]'

export const PLATFORM_NAME = 'discord'

export default class Discord implements PlatformAPI {
  private accountID?: string

  private api = new DiscordNetworkAPI()

  private pollingInterval?: NodeJS.Timeout

  init = async (session?: string, accountInfo?: AccountInfo, prefs?: Record<string, any>) => {
    this.accountID = accountInfo?.accountID
    this.api.accountID = this.accountID

    if (!session) {
      texts.error('No session in init()!')
      return
    }

    await this.api.login(session)

    // this.api.startPolling = this.startPolling
  }

  dispose = () => {
    this.api.disconnect()
    this.stopPolling(false)
  }

  getCurrentUser = () => this.api.getCurrentUser()

  login = async (creds?: LoginCreds): Promise<LoginResult> => {
    if (!creds?.jsCodeResult) return { type: 'error', errorMessage: 'Token was empty' }
    await this.api.login(creds.jsCodeResult)
    return { type: 'success' }
  }

  logout = () => this.api.logout()

  serializeSession = () => this.api.token

  subscribeToEvents = (onEvent: OnServerEventCallback) => {
    this.api.eventCallback = onEvent
  }

  searchUsers = (typed: string) => {
    const typedLower = typed.toLowerCase()
    return typedLower ? this.api.userFriends.filter(u => u.username?.toLowerCase().includes(typedLower)) : this.api.userFriends
  }

  /* searchMessages = (typed: string, pagination?: PaginationArg, threadID?: string) => {
    if (!threadID) return { items: [], hasMore: false }
    const typedLower = typed.toLowerCase()
    return this.api.searchMessages(typedLower, threadID, pagination)
  } */

  getPresence = () => this.api.getUsersPresence()

  getThreads = (folderName: string, pagination?: PaginationArg) => this.api.getThreads(folderName, pagination)

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

  reportThread = (type: 'spam', threadID: string, firstMessageID?: string) => this.api.reportThread(threadID, firstMessageID)

  sendMessage = (threadID: string, content: MessageContent, options?: MessageSendOptions) => this.api.sendMessage(threadID, content, options)

  editMessage = (threadID: string, messageID: string, content: MessageContent, options?: MessageSendOptions) => this.api.editMessage(threadID, messageID, content, options)

  deleteMessage = (threadID: string, messageID: string, forEveryone?: boolean) => this.api.deleteMessage(threadID, messageID, forEveryone)

  addReaction = (threadID: string, messageID: string, reactionKey: string) => this.api.addReaction(threadID, messageID, reactionKey)

  removeReaction = (threadID: string, messageID: string, reactionKey: string) => this.api.removeReaction(threadID, messageID, reactionKey)

  sendActivityIndicator = (type: ActivityType, threadID?: string) => this.api.setTyping(type, threadID)

  sendReadReceipt = (threadID: string, messageID?: string) => {
    if (!messageID) {
      const ogThreadJSON = texts.getOriginalObject?.(PLATFORM_NAME, this.accountID!, ['thread', threadID])
      if (!ogThreadJSON) return
      const ogThread = JSON.parse(ogThreadJSON)
      messageID = ogThread.last_message_id
    }
    if (!messageID) {
      texts.log(`Unable to find last_message_id for threadID: ${threadID}`)
      return
    }
    return this.api.sendReadReceipt(threadID, messageID)
  }

  onThreadSelected = (threadID?: string) => this.api.onThreadSelected(threadID)

  reconnectRealtime = async () => {
    texts.log(`${LOG_PREFIX} reconnectRealtime`)
    await this.api.connect(true, true)
    if (this.api.lastFocusedThread) this.api.eventCallback?.([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: this.api.lastFocusedThread }])
  }

  startPolling = async () => {
    texts.log(`${LOG_PREFIX} Starting polling, interval: ${POLLING_INTERVAL}`)
    const action = async (): Promise<boolean> => {
      texts.log(`${LOG_PREFIX} Polling...`)
      try {
        const user = await this.api.getCurrentUser()
        if (user) {
          texts.log(`${LOG_PREFIX} Poll successful!`)
          await this.stopPolling(true)
          return true
        }
      } catch (error) {
        texts.log(`${LOG_PREFIX} Poll failed!`, error)
      }
      return false
    }
    const success = await action()
    if (!success) this.pollingInterval = setInterval(action, POLLING_INTERVAL)
  }

  stopPolling = async (success: boolean) => {
    texts.log(`${LOG_PREFIX} Stopping polling`)

    if (this.pollingInterval != null) clearInterval(this.pollingInterval)
    this.pollingInterval = undefined

    if (success) {
      await this.api.connect(true, true)
      if (this.api.lastFocusedThread) this.api.eventCallback?.([{ type: ServerEventType.THREAD_MESSAGES_REFRESH, threadID: this.api.lastFocusedThread }])
    }
  }
}
