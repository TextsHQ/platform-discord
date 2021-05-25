// https://github.com/discordjs/discord.js/blob/master/typings/index.d.ts

export type DiscordMessageEmbed = {} & any
export type DiscordMessageAttachment = {} & any

export type DiscordUser = {} & any

export type DiscordMessage = {
  id: string
  channel_id: string
  content: string
  timestamp: string

  pinned: boolean
  mention_everyone: boolean
  tts: boolean

  author: DiscordUser

  attachments: DiscordMessageAttachment[]
  mentions: any[]
  mention_roles: any[]
  components: any[]
  embeds: DiscordMessageEmbed[]
} & any

export type DiscordThread = {} & any
