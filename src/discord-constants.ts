import { platform as osPlatform, release as osRelease } from 'os'
import { texts } from '@textshq/platform-sdk'
import { usesErlpack } from './packers'

export const TYPING_DURATION_MS = 10_000

export const SUPER_PROPERTIES = {
  os: osPlatform() === 'darwin' ? 'Mac OS X' : 'Windows',
  browser: usesErlpack ? 'Discord Client' : 'Chrome',
  device: '',
  system_locale: 'en-US',
  browser_user_agent: texts.constants.USER_AGENT,
  browser_version: texts.constants.USER_AGENT.match(/Chrome\/([0-9.]*)/i)?.[1],
  os_version: osRelease(),
  referrer: '',
  referring_domain: '',
  referrer_current: '',
  referring_domain_current: '',
  release_channel: 'stable',
  client_build_number: 206632,
  client_event_source: null,
}
