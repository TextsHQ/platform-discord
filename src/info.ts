import { PlatformInfo, MessageDeletionMode, Attribute } from '@textshq/platform-sdk'

const info: PlatformInfo = {
  name: 'discord',
  version: '0.1.0',
  tags: ['Alpha', 'Dangerous'],
  displayName: 'Discord',
  icon: `
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="16" height="16" rx="5" fill="#7289DA"/>
    <path d="M10.3559 11.45C10.3559 11.45 10.0508 11.0917 9.79661 10.7833C10.9068 10.475 11.3305 9.79999 11.3305 9.79999C10.983 10.025 10.6525 10.1833 10.3559 10.2917C9.9322 10.4667 9.52542 10.575 9.12711 10.65C8.31355 10.8 7.56779 10.7583 6.9322 10.6417C6.44915 10.55 6.03389 10.425 5.68644 10.2833C5.49152 10.2083 5.27966 10.1167 5.06779 9.99999C5.04237 9.98332 5.01694 9.97499 4.99152 9.95832C4.97457 9.94999 4.9661 9.94166 4.95762 9.94166C4.80508 9.85832 4.72033 9.79999 4.72033 9.79999C4.72033 9.79999 5.12711 10.4583 6.20338 10.775C5.94915 11.0917 5.63559 11.4583 5.63559 11.4583C3.76271 11.4 3.05084 10.2 3.05084 10.2C3.05084 7.54166 4.27118 5.38332 4.27118 5.38332C5.49152 4.49166 6.64406 4.51666 6.64406 4.51666L6.72881 4.61666C5.20338 5.04166 4.50847 5.69999 4.50847 5.69999C4.50847 5.69999 4.69491 5.59999 5.00847 5.46666C5.91525 5.07499 6.63559 4.97499 6.9322 4.94166C6.98305 4.93332 7.02542 4.92499 7.07627 4.92499C7.59322 4.85832 8.17796 4.84166 8.78813 4.90832C9.59322 4.99999 10.4576 5.23332 11.339 5.69999C11.339 5.69999 10.6695 5.07499 9.22881 4.64999L9.34745 4.51666C9.34745 4.51666 10.5085 4.49166 11.7203 5.38332C11.7203 5.38332 12.9407 7.54166 12.9407 10.2C12.9407 10.1917 12.2288 11.3917 10.3559 11.45ZM9.50847 7.59166C9.02542 7.59166 8.64406 7.99999 8.64406 8.50832C8.64406 9.01666 9.03389 9.42499 9.50847 9.42499C9.99152 9.42499 10.3729 9.01666 10.3729 8.50832C10.3729 7.99999 9.98305 7.59166 9.50847 7.59166ZM6.41525 7.59166C5.9322 7.59166 5.55084 7.99999 5.55084 8.50832C5.55084 9.01666 5.94067 9.42499 6.41525 9.42499C6.8983 9.42499 7.27966 9.01666 7.27966 8.50832C7.28813 7.99999 6.8983 7.59166 6.41525 7.59166Z" fill="white"/>
    </svg>
  `,
  loginMode: 'browser',
  browserLogin: {
    loginURL: 'https://discord.com/login',
    authCookieName: 'token',
    windowWidth: 950,
    windowHeight: 650,
    runJSOnLaunch: `
      const iframe = document.createElement('iframe');
      document.head.append(iframe);
      const i = setInterval(() => {
        if (iframe.contentWindow.localStorage.token) {
          clearInterval(i);
          document.cookie = "token=" + iframe.contentWindow.localStorage.token.slice(1, -1);
          return true;
        }
      }, 100)
    `,
  },
  deletionMode: MessageDeletionMode.DELETE_FOR_EVERYONE,
  /* reactions: {
    supported: [],
    supportsDynamicReactions: true,
    canReactWithAllEmojis: true,
    allowsMultipleReactionsToSingleMessage: true
  }, */
  attributes: new Set([
    Attribute.SUPPORTS_PRESENCE,
    Attribute.SUPPORTS_STOP_TYPING_INDICATOR,
    Attribute.SUBSCRIBE_TO_CONN_STATE_CHANGE,
    Attribute.SUPPORTS_QUOTED_MESSAGES,
    Attribute.SUPPORTS_GROUP_IMAGE_CHANGE,
  ]),
  // auth: '<bold>WARNING:</bold> Discord prohibits using third-party clients. <bold>Use at your own risk.</bold>',
}

export default info
