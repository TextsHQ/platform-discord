/* eslint-disable class-methods-use-this */
import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { resolve } from 'path'
import {
  texts,
  PlatformAPI,
  SerializedSession,
  ClientContext,
  CurrentUser,
  LoginResult,
  LoginCreds,
  OnServerEventCallback,
  Paginated,
  PaginationArg,
  Thread,
  ThreadID,
  ThreadFolderName,
  Message,
  MessageID,
  ActivityType,
  OnConnStateChangeCallback,
  OnLoginEventCallback,
  MessageContent,
  MessageSendOptions,
} from '@textshq/platform-sdk'

import { LOG_PREFIX } from '.'
import DiscordNetworkAPI from './network-api'
import { PLATFORM_NAME, Preferences } from './info'

interface TextsDiscordSettings {
  custom_channels?: { id: string, name?: string }[]
}

class DiscordPlatformAPI implements PlatformAPI {
  // Current account ID
  private accountID?: string

  // Discord API helper
  private discordAPI = new DiscordNetworkAPI()

  // private onServerEventCallback?: OnServerEventCallback

  private onLoginEventCallback?: OnLoginEventCallback

  private onConnStateChangeCallback?: OnConnStateChangeCallback

  init = async (session: SerializedSession, context: ClientContext, prefs?: Preferences): Promise<void> => {
    const accountID = context?.accountID

    texts.log(LOG_PREFIX, accountID, 'Hello, world!')

    this.accountID = accountID
    this.discordAPI.accountID = accountID

    this.discordAPI.config.enableGuilds = prefs?.enable_guilds === true

    await this.readTextsConfig()

    if (session) {
      await this._login(session)
    } else {
      texts.log(LOG_PREFIX, 'No `session`!')
    }
  }

  /** `dispose` disconnects all network connections and cleans up. Called when user disables account and when app exits. */
  dispose = async () => {
    texts.log(LOG_PREFIX, this.accountID, 'Disposing')

    // if (this.pollingInterval) this.stopPolling(false)
    // this.api.disconnect()
  }

  /*
  TODO: Return emotes, nitro status etc.
  getPlatformInfo = async (): Promise<Partial<OverridablePlatformInfo>> => {
  }
  */

  subscribeToEvents = (onEvent: OnServerEventCallback) => {
    this.discordAPI.eventCallback = onEvent

    const eventCallbacks = this.discordAPI.pendingEventsQueue
    if (eventCallbacks.length > 0) onEvent(eventCallbacks)

    this.discordAPI.pendingEventsQueue.length = 0
  }

  onLoginEvent = (onEvent: OnLoginEventCallback) => {
    this.onLoginEventCallback = onEvent
  }

  onConnectionStateChange = (onEvent: OnConnStateChangeCallback) => {
    this.onConnStateChangeCallback = onEvent
  }

  getCurrentUser = async (): Promise<CurrentUser> => {
    const user = await this.discordAPI.getCurrentUser()
    if (!user) throw new Error('Failed to get current user!')
    return user
  }

  login = async (creds?: LoginCreds): Promise<LoginResult> => {
    if (!creds || !('jsCodeResult' in creds) || !creds.jsCodeResult) return { type: 'error', errorMessage: 'Token was empty' }
    return this._login(creds.jsCodeResult)
  }

  /** `logout` logs out the user from the platform's servers, session should no longer be valid. Called when user clicks logout. */
  // logout?: () => Awaitable<void>

  serializeSession = async (): Promise<SerializedSession> => this.discordAPI.token

  // searchUsers?: (typed: string) => Awaitable<User[]>

  // searchThreads?: (typed: string) => Awaitable<Thread[]>

  // searchMessages?: (typed: string, pagination?: PaginationArg, options?: SearchMessageOptions) => Awaitable<Paginated<Message>>

  getPresence = () => this.discordAPI.usersPresence

  // getCustomEmojis?: () => Awaitable<CustomEmojiMap>

  getThreads = async (folderName: ThreadFolderName, pagination?: PaginationArg): Promise<Paginated<Thread>> =>
    this.discordAPI.getThreads(folderName, pagination)

  /** Messages should be sorted by timestamp asc → desc */
  getMessages = async (threadID: ThreadID, pagination?: PaginationArg): Promise<Paginated<Message>> =>
    this.discordAPI.getMessages(threadID, pagination)

  // getThreadParticipants?: (threadID: ThreadID, pagination?: PaginationArg) => Awaitable<Paginated<Participant>>

  // getStickerPacks?: (pagination?: PaginationArg) => Awaitable<Paginated<StickerPack>>

  // getStickers?: (stickerPackID: StickerPackID, pagination?: PaginationArg) => Awaitable<Paginated<Attachment>>

  // getThread?: (threadID: ThreadID) => Awaitable<Thread | undefined>

  // getMessage?: (threadID: ThreadID, messageID: MessageID) => Awaitable<Message | undefined>

  // getUser?: (ids: { userID: UserID } | { username: string } | { phoneNumber: PhoneNumber } | { email: string }) => Awaitable<User | undefined>

  // createThread?: (userIDs: UserID[], title?: string, messageText?: string) => Awaitable<boolean | Thread>

  updateThread = async (threadID: ThreadID, updates: Partial<Thread>) => this.discordAPI.updateThread(threadID, updates)

  // deleteThread?: (threadID: ThreadID) => Awaitable<void>

  // reportThread?: (type: 'spam', threadID: ThreadID, firstMessageID?: MessageID) => Awaitable<boolean>

  sendMessage = async (threadID: ThreadID, content: MessageContent, options?: MessageSendOptions) => this.discordAPI.sendMessage(threadID, content, options)

  // editMessage?: (threadID: ThreadID, messageID: MessageID, content: MessageContent, options?: MessageSendOptions) => Promise<boolean | Message[]>

  // forwardMessage?: (threadID: ThreadID, messageID: MessageID, threadIDs?: ThreadID[], userIDs?: UserID[], opts?: { noAttribution?: boolean }) => Promise<void>

  sendActivityIndicator = async (type: ActivityType, threadID?: ThreadID) => {
    switch (type) {
      case ActivityType.TYPING:
        if (threadID) await this.discordAPI.sendTypingIndicator(threadID)
        break
      default:
        break
    }
  }

  deleteMessage = async (threadID: ThreadID, messageID: MessageID, forEveryone?: boolean) => this.discordAPI.deleteMessage(threadID, messageID)

  sendReadReceipt = async (threadID: ThreadID, messageID?: MessageID, messageCursor?: string) => this.discordAPI.sendReadReceipt(threadID, messageID, messageCursor)

  // addReaction?: (threadID: ThreadID, messageID: MessageID, reactionKey: string) => Awaitable<void>

  // removeReaction?: (threadID: ThreadID, messageID: MessageID, reactionKey: string) => Awaitable<void>

  // getLinkPreview?: (link: string) => Awaitable<MessageLink | undefined>

  // addParticipant?: (threadID: ThreadID, participantID: UserID) => Awaitable<void>

  // removeParticipant?: (threadID: ThreadID, participantID: UserID) => Awaitable<void>

  // changeParticipantRole?: (threadID: ThreadID, participantID: UserID, role: 'admin' | 'regular') => Awaitable<void>

  // changeThreadImage?: (threadID: ThreadID, imageBuffer: Buffer, mimeType: string) => Awaitable<void>

  // markAsUnread?: (threadID: ThreadID, messageID?: MessageID) => Awaitable<void>

  // archiveThread?: (threadID: ThreadID, archived: boolean) => Awaitable<void>

  // pinThread?: (threadID: ThreadID, pinned: boolean) => Awaitable<void>

  // notifyAnyway?: (threadID: ThreadID) => Awaitable<void>

  /** called by the client when an attachment (video/audio/image) is marked as played by user */
  // markAttachmentPlayed?: (attachmentID: AttachmentID, messageID?: MessageID) => Awaitable<void>

  onThreadSelected = async (threadID: ThreadID) => this.discordAPI.onThreadSelected(threadID)

  // loadDynamicMessage?: (message: Message) => Awaitable<Partial<Message>>

  // registerForPushNotifications?: (type: keyof NotificationsInfo, token: string) => Awaitable<void>

  // unregisterForPushNotifications?: (type: keyof NotificationsInfo, token: string) => Awaitable<void>

  // getAsset?: (fetchOptions?: GetAssetOptions, ...args: string[]) => Awaitable<FetchURL | FetchInfo | Buffer | Readable | Asset>

  /** `getAssetInfo` must be implemented if getAsset supports fetchOptions.range */
  // getAssetInfo?: (fetchOptions?: GetAssetOptions, ...args: string[]) => Awaitable<AssetInfo>

  /** `getOriginalObject` returns the JSON representation of the original thread or message */
  // getOriginalObject?: (objName: 'thread' | 'message', objectID: ThreadID | MessageID) => Awaitable<string>

  // handleDeepLink?: (link: string) => void

  /** reconnect any websocket, mqtt or network connections since client thinks it's likely to have broken */
  // reconnectRealtime?: () => void

  private _login = async (token: string): Promise<LoginResult> => {
    try {
      texts.log(LOG_PREFIX, this.accountID, 'Logging in with token...')
      await this.discordAPI.login(token)

      const currentUser = await this.discordAPI.getCurrentUser()
      if (!currentUser) throw new Error('Failed to get current user!')

      return { type: 'success' }
    } catch (err) {
      texts.log(LOG_PREFIX, this.accountID, 'Failed login!', err)
      return {
        type: 'error',
        errorMessage: `${err}`,
      }
    }
  }

  private readTextsConfig = async () => {
    try {
      const configPath = resolve(homedir(), '.texts-conf.json')
      const configContent = await readFile(configPath)
      const config = JSON.parse(configContent.toString())
      if (config[PLATFORM_NAME]) {
        const settings = config[PLATFORM_NAME] as TextsDiscordSettings
        console.log(LOG_PREFIX, 'Custom settings:', settings)

        this.discordAPI.config.customChannels = settings.custom_channels
      }
    } catch (err) {
      console.log(LOG_PREFIX, 'Failed to read custom settings:', err)
    }
  }
}

export default DiscordPlatformAPI
