import * as os from 'os'
import { usesErlpack } from './packers'

export const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) discord/0.0.264 Chrome/91.0.4472.164 Electron/13.4.0 Safari/537.36'

export const EPOCH = 1420070400000

export const SUPER_PROPERTIES = {
  os: os.platform() === 'darwin' ? 'Mac OS X' : 'Windows',
  browser: usesErlpack ? 'Discord Client' : 'Chrome',
  device: '',
  system_locale: 'en-US',
  browser_user_agent: USER_AGENT,
  browser_version: USER_AGENT.match(/Chrome\/([0-9.]*)/i)?.at(1),
  os_version: os.release(),
  referrer: '',
  referring_domain: '',
  referrer_current: '',
  referring_domain_current: '',
  release_channel: 'stable',
  client_build_number: 128323,
  client_event_source: null,
}
