import { texts } from '@textshq/platform-sdk'
import os from 'os'
import { DISCORD_BUILD_NUMBER } from './constants'

const DISCORD_EPOCH = 1420070400000

// @ts-expect-error bigint notation
const DISCORD_EPOCH_BI = 1420070400000n

export const SUPER_PROPERTIES = {
  os: os.platform() === 'darwin' ? 'Mac OS X' : 'Windows',
  browser: 'Chrome',
  device: '',
  system_locale: 'en-US',
  browser_user_agent: texts.constants.USER_AGENT,
  browser_version: texts.constants.USER_AGENT.match(/Chrome\/([0-9.]*)/i)[1],
  os_version: os.release(),
  referrer: '',
  referring_domain: '',
  referrer_current: '',
  referring_domain_current: '',
  release_channel: 'stable',
  client_build_number: DISCORD_BUILD_NUMBER,
  client_event_source: null,
}

export const sleep = (timeout: number) => new Promise(resolve => setTimeout(resolve, timeout))

export function getTimestampFromSnowflake(snowflake?: string): Date | undefined {
  if (!snowflake) return
  const int = BigInt.asUintN(64, BigInt(snowflake))
  // @ts-expect-error bigint notation
  const dateBits = Number(int >> 22n)
  return new Date(dateBits + DISCORD_EPOCH)
}

// @ts-expect-error bigint notation
let snowflakeIncrement = 0n

// @ts-expect-error bigint notation
export function generateSnowflake(timestamp = Date.now(), workerID = 1n, processID = 1n): bigint {
  // @ts-expect-error bigint notation
  if (snowflakeIncrement >= 4095n) snowflakeIncrement = 0n
  // timestamp, workerID, processID, increment
  // @ts-expect-error bigint notation
  return ((BigInt(timestamp) - DISCORD_EPOCH_BI) << 22n) | (workerID << 17n) | (processID << 12n) | snowflakeIncrement++
}

const MIME_TYPES = {
  gif: 'image/gif',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  mp4: 'video/mp4',
}

export function mapMimeType(url: string) {
  const elements = url.split('.')
  if (!elements || elements.length === 0) return
  const ext = elements[elements.length - 1]
  return MIME_TYPES[ext.toLowerCase()]
}

// @ts-expect-error bigint notation
let scienceIncrement = 0n

// https://docs.google.com/document/d/1b5aDx7S1iLHoeb6B56izZakbXItA84gUjFzK-0OBwy0
export function generateScienceClientUUID(userIDStr?: string): string {
  if (!userIDStr) return

  const randomPrefix = 0 | Math.floor(4294967296 * Math.random())
  const creationTime = BigInt(Date.now())
  const userID = BigInt(userIDStr)

  const r = Buffer.allocUnsafe(24)

  // @ts-expect-error bigint notation
  r.writeInt32LE(Number(userID % 4294967296n), 0)

  // @ts-expect-error bigint notation
  r.writeInt32LE(Number(userID >> 32n), 4)
  r.writeInt32LE(randomPrefix, 8)

  // @ts-expect-error bigint notation
  r.writeInt32LE(Number(creationTime % 4294967296n), 12)

  // @ts-expect-error bigint notation
  r.writeInt32LE(Number(creationTime >> 32n), 16)
  r.writeInt32LE(Number(scienceIncrement++), 20)

  return r.toString('base64')
}
