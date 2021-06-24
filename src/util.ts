const DISCORD_EPOCH = 1420070400000

export const sleep = (timeout: number) => new Promise(resolve => setTimeout(resolve, timeout))

export function getTimestampFromSnowflake(snowflake: string) {
  if (!snowflake) return
  const int = BigInt.asUintN(64, BigInt(snowflake))
  // @ts-expect-error
  const dateBits = Number(int >> 22n)
  return new Date(dateBits + DISCORD_EPOCH)
}
