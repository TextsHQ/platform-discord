import { CookieJar } from 'tough-cookie'
import { PlatformAPI, OnServerEventCallback, LoginResult, Paginated, Thread, Message, CurrentUser, InboxName, MessageContent, PaginationArg } from '@textshq/platform-sdk'
import DiscordAPI from './network-api'

export default class Discord implements PlatformAPI {
  private api: DiscordAPI = new DiscordAPI()

  eventCallback: OnServerEventCallback

  init = async (cookieJarJSON: any) => {
    if (!cookieJarJSON) return
    const cookieJar = CookieJar.fromJSON(cookieJarJSON)
    await this.api.setLoginState(cookieJar)
  }

  login = async (creds): Promise<LoginResult> => {
    if (!creds.cookieJarJSON) return { type: 'error' }
    await this.api.setLoginState(CookieJar.fromJSON(creds.cookieJarJSON as any))
    return { type: 'success' }
  }

  serializeSession = () => this.api.cookieJar.toJSON()

  getCurrentUser = async (): Promise<CurrentUser> => this.api.getCurrentUser()

  subscribeToEvents = (onEvent: OnServerEventCallback) => {
    this.eventCallback = onEvent
    this.api.eventCallback = onEvent
    this.poll()
  }

  poll = async () => { }

  dispose = () => { }

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
    // TODO: Improve this - check if there's more messages
    return { items: await this.api.getMessages(threadID, pagination), hasMore: true }
  }

  sendMessage = async (threadID: string, content: MessageContent) => this.api.sendMessage(threadID, content)

  sendActivityIndicator = (threadID: string) => { }

  sendReadReceipt = async (threadID: string, messageID: string) => { }
}
