import { platform as osPlatform } from 'os'
import { usesErlpack } from './packers'

export const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) discord/0.0.264 Chrome/91.0.4472.164 Electron/13.4.0 Safari/537.36'

export const EPOCH = 1420070400000

// @ts-expect-error bigint notation
export const EPOCH_BI = 1420070400000n

export const SUPER_PROPERTIES = {
  os: osPlatform() === 'darwin' ? 'Mac OS X' : 'Windows',
  browser: usesErlpack ? 'Discord Client' : 'Chrome',
  // device: '',
  // system_locale: 'en-US',
  // browser_user_agent: USER_AGENT,
  // browser_version: USER_AGENT.match(/Chrome\/([0-9.]*)/i)[1],
  // os_version: os.release(),
  // referrer: '',
  // referring_domain: '',
  // referrer_current: '',
  // referring_domain_current: '',
  release_channel: 'stable',
  client_version: '0.0.264',
  os_version: '21.2.0',
  os_arch: 'x64',
  system_locale: 'en-US',
  client_build_number: 105691,
  client_event_source: null,
}
