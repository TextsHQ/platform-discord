export const getUserAvatarURL = (userID: string, avatarID: string, size = 256) =>
  `https://cdn.discordapp.com/avatars/${userID}/${avatarID}.${avatarID.startsWith('a_') ? 'gif' : 'png'}?size=${size}`
