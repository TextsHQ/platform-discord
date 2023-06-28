export const getEmojiURL = (emojiID: string, animated?: boolean) => `https://cdn.discordapp.com/emojis/${emojiID}.${animated ? 'gif' : 'png'}`
