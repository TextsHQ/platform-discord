// @ts-expect-error bigint notation
export const DISCORD_EPOCH_BI = 1420070400000n

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
