const DISCORD_EPOCH = 1420070400000

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
  // @ts-expect-error
  const dateBits = Number(int >> 22n)
  return new Date(dateBits + DISCORD_EPOCH)
}

export function mapMimeType(url: string) {
  const elements = url.split('.')
  if (!elements || elements.length === 0) return
  const ext = elements[elements.length - 1]
  return MIME_TYPES[ext.toLowerCase()]
}
