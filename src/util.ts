import { MessageAttachmentType } from '@textshq/platform-sdk'
import { EPOCH as DISCORD_EPOCH } from './discord-constants'

export { setTimeout as sleep } from 'timers/promises'

export const getDataURI = (buffer: Buffer, mimeType = '') => `data:${mimeType};base64,${buffer.toString('base64')}`

export function getTimestampFromSnowflake(snowflake?: string | null): Date | undefined {
  if (!snowflake) return
  const int = BigInt.asUintN(64, BigInt(snowflake))
  const dateBits = Number(int >> 22n)
  return new Date(dateBits + DISCORD_EPOCH)
}

let scienceIncrement = 0n

// https://docs.google.com/document/d/1b5aDx7S1iLHoeb6B56izZakbXItA84gUjFzK-0OBwy0
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
  r.writeInt32LE(Number(scienceIncrement++), 20)

  return r.toString('base64')
}

// TODO: Support more types / improve this
const MIME_TYPES: { [key: string]: string } = {
  gif: 'image/gif',
  gifv: 'image/gif',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  mp4: 'video/mp4',
}
export const mapMimeType = (url: string): string | undefined => {
  const ext = url.split('.').pop()?.toLowerCase()
  if (!ext) return
  return MIME_TYPES[ext]
}

export const parseMediaURL = (url: string): { isGif?: boolean, type: MessageAttachmentType } => {
  const extension = url.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'gif':
    case 'gifv':
      return { isGif: true, type: MessageAttachmentType.IMG }
    case 'png':
    case 'jpeg':
    case 'jpg':
    case 'webp':
      return { isGif: false, type: MessageAttachmentType.IMG }
    case 'avi':
    case 'mp4':
    case 'mov':
      return { type: MessageAttachmentType.VIDEO }
    case 'mp3':
    case 'wav':
    case 'm4a':
    case 'ogg':
      return { type: MessageAttachmentType.AUDIO }
    default:
      return { type: MessageAttachmentType.UNKNOWN }
  }
}

export const getUserAvatar = (userID: string, avatarID: string) => `https://cdn.discordapp.com/avatars/${userID}/${avatarID}.${avatarID.startsWith('a_') ? 'gif' : 'png'}?size=256`

export const getThreadIcon = (threadID: string, iconID: string) => `https://cdn.discordapp.com/channel-icons/${threadID}/${iconID}.png`

/* export const getGuildIcon = (guildID: string, iconID: string) => `https://cdn.discordapp.com/icons/${guildID}/${iconID}.png` */

export const getLottieStickerURL = (id: string) => `https://discord.com/stickers/${id}.json`

// adding &passthrough=false makes it a regular png instead of apng
export const getPNGStickerURL = (id: string) => `https://media.discordapp.net/stickers/${id}.png?size=512`

export const getEmojiURL = (emojiID: string, animated?: boolean) => `https://cdn.discordapp.com/emojis/${emojiID}.${animated ? 'gif' : 'png'}`
