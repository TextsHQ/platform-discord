import { FaDiscord } from 'react-icons/fa'
import { PlatformInfo, MessageDeletionMode, Attribute } from '@textshq/platform-sdk'

const info: PlatformInfo = {
  name: 'discord',
  version: '0.1.0',
  tags: ['Alpha'],
  displayName: 'Discord',
  icon: FaDiscord,
  loginMode: 'browser',
  browserLogin: {
    loginURL: 'https://discord.com/login',
    authCookieName: 'token',
    windowWidth: 950,
    windowHeight: 650,
    runJSOnLaunch: `
      const iframe = document.createElement('iframe');
      document.head.append(iframe);

      const i = setInterval(function() {
        if (iframe.contentWindow.localStorage.token) {
          clearInterval(i);
          document.cookie = "token=" + iframe.contentWindow.localStorage.token.slice(1, -1);
        }
      }, 100)
    `,
  },
  deletionMode: MessageDeletionMode.DELETE_FOR_EVERYONE,
  attributes: new Set([
    Attribute.NO_CACHE,
  ]),
}

export default info
