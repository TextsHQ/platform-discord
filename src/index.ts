import type { Platform } from '@textshq/platform-sdk'

export const DEBUG = false // Extra debug logging

export const LOG_PREFIX = '[discord]'

export const DISCORD_API_VERSION = 9
export const DISCORD_API_ENDPOINT = `https://discord.com/api/v${DISCORD_API_VERSION}`
export const DISCORD_DEFAULT_GATEWAY = 'wss://gateway.discord.gg'
export const DISCORD_ENABLE_ANALYTICS = true // Send `/science` requests?
export const DISCORD_ENABLE_GUILDS = false // Risky - Allow user to see guilds?
export const DISCORD_ENABLE_GUILDS_DM_MEMBERS = false // REALLY RISKY - Allow user to dm guild members?

export default {
  get info() {
    return require('./info').default
  },

  get api() {
    return require('./api').default
  },
} as Platform
