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
    loginURL: 'https://discord.com/api/oauth2/authorize?client_id=807610792647852032&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fdiscord%2Foauth2&response_type=code&scope=email%20identify%20messages.read%20webhook.incoming%20guilds%20rpc%20rpc.notifications.read%20relationships.read',
    authCookieName: 'token',
    windowWidth: 950,
    windowHeight: 650,
    runJSOnNavigate: 'console.log(document.location.href)',
  },
  deletionMode: MessageDeletionMode.DELETE_FOR_EVERYONE,
  attributes: new Set([
    Attribute.NO_CACHE,
  ]),
}

export default info
