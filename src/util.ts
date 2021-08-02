const DISCORD_EPOCH = 1420070400000

// @ts-expect-error bigint notation
const DISCORD_EPOCH_BI = 1420070400000n

const MIME_TYPES = {
  gif: 'image/gif',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  mp4: 'video/mp4',
}

export const sleep = (timeout: number) => new Promise(resolve => setTimeout(resolve, timeout))

export function getTimestampFromSnowflake(snowflake: string) {
  if (!snowflake) return
  const int = BigInt.asUintN(64, BigInt(snowflake))
  // @ts-expect-error bigint notation
  const dateBits = Number(int >> 22n)
  return new Date(dateBits + DISCORD_EPOCH)
}

// @ts-expect-error bigint notation
let increment = 0n

// @ts-expect-error bigint notation
export function generateSnowflake(timestamp = Date.now(), workerID = 1n, processID = 1n) {
  // @ts-expect-error bigint notation
  if (increment >= 4095n) increment = 0n
  // timestamp, workerID, processID, increment
  // @ts-expect-error bigint notation
  return ((BigInt(timestamp) - DISCORD_EPOCH_BI) << 22n) | (workerID << 17n) | (processID << 12n) | increment++
}

export function mapMimeType(url: string) {
  const elements = url.split('.')
  if (!elements || elements.length === 0) return
  const ext = elements[elements.length - 1]
  return MIME_TYPES[ext.toLowerCase()]
}
