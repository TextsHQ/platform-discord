import { CookieJar } from 'tough-cookie'
import { PlatformAPI, OnServerEventCallback, LoginResult, Paginated, Thread, Message, CurrentUser, InboxName, MessageContent, PaginationArg, OnConnStateChangeCallback, ActivityType } from '@textshq/platform-sdk'
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

  getCurrentUser = async () => this.api.getCurrentUser()

  subscribeToEvents = (onEvent: OnServerEventCallback) => {
    this.api.eventCallback = onEvent
    this.poll()
  }

  onConnectionStateChange = async (onEvent: OnConnStateChangeCallback): Promise<void> => {
    this.api.connectionStateChangeCallback = onEvent
  }

  poll = async () => { }

  searchUsers = async (typed: string) => []

  createThread = (userIDs: string[]) => {
    /* const thread: Thread = {
      id: string;
      title?: string;
      isUnread: boolean;
      isReadOnly: boolean;
      isArchived?: boolean;
      isPinned?: boolean;
      mutedUntil?: Date | 'forever';
      type: ThreadType;
      timestamp: Date;
      imgURL?: string;
      createdAt?: Date;
      description?: string;
      lastMessageSnippet?: string;
      messageExpirySeconds?: number;
      messages: Paginated<Message>;
      participants: Paginated<Participant>;
    } */

    return false
  }

  getThreads = async (inboxName: InboxName, pagination?: PaginationArg): Promise<Paginated<Thread>> => {
    return { items: await this.api.getThreads(inboxName, pagination), hasMore: false }
  }

  getMessages = async (threadID: string, pagination?: PaginationArg): Promise<Paginated<Message>> => {
    // TODO: Check if there's more messages
    return { items: await this.api.getMessages(threadID, pagination), hasMore: true }
  }

  sendMessage = async (threadID: string, content: MessageContent) => this.api.sendMessage(threadID, content)

  sendActivityIndicator = async (type: ActivityType, threadID: string) => this.api.setTyping(type, threadID)

  sendReadReceipt = async (threadID: string, messageID: string) => { }

  deleteMessage = async (threadID: string, messageID: string, forEveryone?: boolean) => this.api.deleteMessage(threadID, messageID, forEveryone)
}
