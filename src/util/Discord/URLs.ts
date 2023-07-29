const CDN_URL = 'https://cdn.discordapp.com'
const MEDIA_URL = 'https://media.discordapp.net'

export const getChannelIconURL = (channelID: string, iconID: string) => `${CDN_URL}/channel-icons/${channelID}/${iconID}.png`

export const getEmojiURL = (emojiID: string, animated?: boolean) => `${CDN_URL}/emojis/${emojiID}.${animated ? 'gif' : 'png'}`

export const getStickerURL = (stickerID: string) => `${MEDIA_URL}/stickers/${stickerID}.png`

export const getUserAvatarURL = (userID: string, avatarID: string, size = 256) => `${CDN_URL}/avatars/${userID}/${avatarID}.${avatarID.startsWith('a_') ? 'gif' : 'png'}?size=${size}`
