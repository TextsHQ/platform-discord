import { PlatformInfo, MessageDeletionMode, Attribute } from '@textshq/platform-sdk'
import { generateSnowflake } from './common-util'

const info: PlatformInfo = {
  name: 'discord',
  version: '2021.08.01',
  displayName: 'Discord',
  icon: `
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="16" height="16" rx="5" fill="#5865F2"/>
    <path d="M11.471 4.7883C10.8236 4.48544 10.1315 4.26533 9.40787 4.14C9.31901 4.30067 9.21518 4.51678 9.1436 4.68869C8.37438 4.57301 7.61223 4.57301 6.85715 4.68869C6.78558 4.51678 6.6794 4.30067 6.58973 4.14C5.86534 4.26533 5.1724 4.48625 4.52508 4.78991C3.21943 6.76291 2.8655 8.68691 3.04247 10.5836C3.90844 11.2303 4.74767 11.6231 5.57274 11.8802C5.77645 11.5998 5.95814 11.3018 6.11466 10.9877C5.81656 10.8744 5.53105 10.7346 5.26128 10.5723C5.33285 10.5193 5.40286 10.4639 5.47049 10.4068C7.11591 11.1765 8.90371 11.1765 10.5295 10.4068C10.5979 10.4639 10.6679 10.5193 10.7387 10.5723C10.4681 10.7354 10.1818 10.8752 9.88373 10.9885C10.0403 11.3018 10.2212 11.6006 10.4257 11.881C11.2515 11.6239 12.0915 11.2311 12.9575 10.5836C13.1651 8.38485 12.6028 6.47852 11.471 4.7883ZM6.33882 9.41714C5.84488 9.41714 5.43981 8.95602 5.43981 8.39449C5.43981 7.83296 5.83623 7.37104 6.33882 7.37104C6.84143 7.37104 7.24648 7.83215 7.23783 8.39449C7.23862 8.95602 6.84143 9.41714 6.33882 9.41714ZM9.66114 9.41714C9.1672 9.41714 8.76213 8.95602 8.76213 8.39449C8.76213 7.83296 9.15854 7.37104 9.66114 7.37104C10.1637 7.37104 10.5688 7.83215 10.5602 8.39449C10.5602 8.95602 10.1637 9.41714 9.66114 9.41714Z" fill="white"/>
    </svg>
  `,
  brand: {
    background: '#5865F2',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 48 48">
    <path fill="black" d="M35.801 13.076a27.696 27.696 0 0 0-7.014-2.204 20.587 20.587 0 0 0-.899 1.865 25.757 25.757 0 0 0-7.774 0 19.947 19.947 0 0 0-.909-1.865 27.594 27.594 0 0 0-7.02 2.21c-4.439 6.707-5.642 13.25-5.04 19.698 2.944 2.199 5.797 3.534 8.602 4.408a21.403 21.403 0 0 0 1.843-3.034 18.133 18.133 0 0 1-2.902-1.413c.244-.18.482-.368.712-.562 5.594 2.617 11.673 2.617 17.2 0 .233.194.47.382.712.562-.92.555-1.894 1.03-2.907 1.416a21.325 21.325 0 0 0 1.842 3.034c2.808-.874 5.664-2.21 8.608-4.411.706-7.476-1.205-13.957-5.054-19.704ZM18.352 28.814c-1.68 0-3.057-1.568-3.057-3.477 0-1.91 1.348-3.48 3.057-3.48 1.709 0 3.086 1.568 3.057 3.48.002 1.91-1.348 3.477-3.057 3.477Zm11.296 0c-1.68 0-3.057-1.568-3.057-3.477 0-1.91 1.348-3.48 3.057-3.48 1.709 0 3.086 1.568 3.057 3.48 0 1.91-1.348 3.477-3.057 3.477Z"/>
    </svg>`,
  },
  loginMode: 'browser',
  browserLogins: [{
    url: 'https://discord.com/login',
    windowWidth: 950,
    windowHeight: 650,
    runJSOnClose: 'token',
    runJSOnLaunch: `
      let token = ""
      const iframe = document.createElement('iframe')
      document.head.append(iframe)
      const i = setInterval(() => {
        const t = iframe.contentWindow.localStorage.token
        if (t) {
          token = t.slice(1, -1)
          clearInterval(i)
          setTimeout(() => window.close(), 500)
        }
      }, 200)
    `,
  }],
  deletionMode: MessageDeletionMode.DELETE_FOR_EVERYONE,
  reactions: {
    supported: {},
    canReactWithAllEmojis: true,
    allowsMultipleReactionsToSingleMessage: true,
  },
  attributes: new Set([
    Attribute.CAN_MESSAGE_USERNAME,
    Attribute.CANNOT_MESSAGE_SELF,
    Attribute.SUPPORTS_PRESENCE,
    Attribute.SUPPORTS_QUOTED_MESSAGES,
    Attribute.SUPPORTS_GROUP_IMAGE_CHANGE,
    Attribute.SUPPORTS_EDIT_MESSAGE,
    Attribute.SUPPORTS_CUSTOM_EMOJIS,
    Attribute.SUPPORTS_REPORT_THREAD,
    Attribute.SUPPORTS_DELETE_THREAD,
    Attribute.SUPPORTS_STOP_TYPING_INDICATOR,
    // Attribute.SUPPORTS_SEARCH,
    Attribute.SUPPORTS_PUSH_NOTIFICATIONS,
    Attribute.SUBSCRIBE_TO_THREAD_SELECTION,
    Attribute.SUBSCRIBE_TO_CONN_STATE_CHANGE,
    Attribute.SUBSCRIBE_TO_ONLINE_OFFLINE_ACTIVITY,
  ]),
  attachments: {
    recordedAudioMimeType: 'audio/ogg',
    gifMimeType: 'image/gif',
    supportsCaption: true,
    maxSize: {
      // todo: conditionally change for nitro and non-nitro users with platform info override
      // Discord Nitro: "Upload what you want with increased 100MB upload size."
      image: 100 * 1024 * 1024,
      video: 100 * 1024 * 1024,
      audio: 100 * 1024 * 1024,
      files: 100 * 1024 * 1024,
    },
  },
  notifications: {
    android: {
      senderID: '162066849712',
    },
  },
  maxGroupTitleLength: 100,
  generateUniqueMessageID: () => generateSnowflake().toString(),
  // prefs: {
  //   enable_guilds: {
  //     label: 'Enable guilds',
  //     type: 'checkbox',
  //     default: false,
  //   },
  // },
}

export default info
