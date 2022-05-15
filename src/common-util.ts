export const DISCORD_EPOCH_BI = 1420070400000n

let snowflakeIncrement = 0n

export function generateSnowflake(timestamp = Date.now(), workerID = 1n, processID = 1n): bigint {
  if (snowflakeIncrement >= 4095n) snowflakeIncrement = 0n
  // timestamp, workerID, processID, increment
  return ((BigInt(timestamp) - DISCORD_EPOCH_BI) << 22n) | (workerID << 17n) | (processID << 12n) | snowflakeIncrement++
}
