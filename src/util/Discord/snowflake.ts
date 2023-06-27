export const DISCORD_EPOCH_BI = 1420070400000n

let SNOWFLAKE_INCREMENT = 0n

export function dateFromSnowflake(str: string): Date | undefined {
  const snowflake = BigInt(str)
  const dateBits = Number(BigInt.asUintN(64, snowflake) >> 22n)
  return new Date(dateBits + Number(DISCORD_EPOCH_BI))
}

export function generateSnowflake(timestamp = Date.now(), workerID = 1n, processID = 1n): bigint {
  if (SNOWFLAKE_INCREMENT >= 4095n) SNOWFLAKE_INCREMENT = 0n
  // timestamp, workerID, processID, increment
  return ((BigInt(timestamp) - DISCORD_EPOCH_BI) << 22n) | (workerID << 17n) | (processID << 12n) | SNOWFLAKE_INCREMENT++
}
