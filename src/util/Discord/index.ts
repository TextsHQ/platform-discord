/* Science */

let SCIENCE_INCREMENT = 0n

export const generateScienceClientUUID = (userIDStr?: string): string | undefined => {
  if (!userIDStr) return

  const randomPrefix = 0 | Math.floor(4294967296 * Math.random())
  const creationTime = BigInt(Date.now())
  const userID = BigInt(userIDStr)

  const r = Buffer.allocUnsafe(24)

  r.writeInt32LE(Number(userID % 4294967296n), 0)

  r.writeInt32LE(Number(userID >> 32n), 4)
  r.writeInt32LE(randomPrefix, 8)

  r.writeInt32LE(Number(creationTime % 4294967296n), 12)

  r.writeInt32LE(Number(creationTime >> 32n), 16)
  r.writeInt32LE(Number(SCIENCE_INCREMENT++), 20)

  return r.toString('base64')
}

/* Snowflakes */

export const DISCORD_EPOCH_BI = 1420070400000n

let SNOWFLAKE_INCREMENT = 0n

export const dateFromSnowflake = (str: string): Date | undefined => {
  const snowflake = BigInt(str)
  const dateBits = Number(BigInt.asUintN(64, snowflake) >> 22n)
  return new Date(dateBits + Number(DISCORD_EPOCH_BI))
}

export const generateSnowflake = (timestamp = Date.now(), workerID = 1n, processID = 1n): bigint => {
  if (SNOWFLAKE_INCREMENT >= 4095n) SNOWFLAKE_INCREMENT = 0n
  // timestamp, workerID, processID, increment
  return ((BigInt(timestamp) - DISCORD_EPOCH_BI) << 22n) | (workerID << 17n) | (processID << 12n) | SNOWFLAKE_INCREMENT++
}

/* URLs */

export * as URLs from './URLs'
