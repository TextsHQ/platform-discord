import { MessageAttachmentType, texts } from '@textshq/platform-sdk'
import type { MessageAttachment, MessageLink, Tweet } from '@textshq/platform-sdk'
import type { APIEmbed } from 'discord-api-types'
import { mapMimeType, parseMediaURL } from '../util'
import type { DiscordMessage } from '../types'

// TODO: Article embed (shows up as unknown)
export const handleArticleEmbed = (embed: APIEmbed) => {
  texts.log(embed)
}

export const handleGifvEmbed = (embed: APIEmbed): MessageAttachment => {
  const url = (embed.video?.url ?? embed.url)!
  const { type, isGif } = parseMediaURL(url)
  const attachment: MessageAttachment = {
    id: url!,
    type,
    mimeType: mapMimeType(url),
    isGif,
    srcURL: url,
    size: embed.video?.width && embed.video.height ? { width: embed.video.width, height: embed.video.height } : undefined,
  }
  return attachment
}

export const handleImageEmbed = (embed: APIEmbed): MessageAttachment => {
  const image = embed.image ?? embed.thumbnail
  const { type, isGif } = parseMediaURL((image?.url ?? image?.proxy_url)!)
  const attachment: MessageAttachment = {
    id: (embed.url ?? image?.url)!,
    type,
    mimeType: image?.url ? mapMimeType(image.url) : undefined,
    isGif,
    srcURL: image?.url,
    size: image?.width && image.height ? { width: image.width, height: image.height } : undefined,
  }
  return attachment
}

export const handleLinkEmbed = (embed: APIEmbed): MessageLink => {
  const image = embed.image ?? embed.thumbnail
  const link: MessageLink = {
    url: embed.url!,
    img: image?.url,
    imgSize: image?.width && image?.height ? { width: image.width, height: image.height } : undefined,
    title: embed.title ?? embed.author?.name ?? '',
    summary: embed.description || undefined,
  }
  return link
}

const urlRegex = /https?:\/\/(www\.)?([-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6})\b\/([-a-zA-Z0-9()!@:%_+.~#?&/=]*)/gi

const handleTweetEmbed = (embed: APIEmbed, message: DiscordMessage, path: string): { tweet?: Tweet, link?: MessageLink } | undefined => {
  const [user,, tweetID] = path.split('/')
  if (tweetID) {
    // Tweet URL

    /*
        Discord treats every tweet image as standalone rich embed.
        We're searching for all of them later, so discard every standalone rich embed with only image/video.
    */
    if ((embed.image || embed.video) && !(embed.title || embed.description || embed.footer || embed.color)) return

    const images = [embed.image, ...(message.embeds?.filter(e => e.url === embed.url && (e.image || e.video) && !e.timestamp).map(e => e.image))].filter(Boolean).map(image => ({
      id: image?.url!,
      srcURL: image?.url,
      type: MessageAttachmentType.IMG,
      size: image?.width && image?.height ? { width: image.width, height: image.height } : undefined,
    }))
    const video = embed.video ? {
      id: embed.video.url,
      srcURL: embed.thumbnail?.url,
      type: MessageAttachmentType.IMG,
      size: embed.thumbnail?.width && embed.thumbnail?.height ? { width: embed.thumbnail.width, height: embed.thumbnail.height } : undefined,
    } : undefined
    const tweet: Tweet = {
      id: tweetID,
      user: {
        imgURL: embed.author?.icon_url ?? '',
        name: user,
        username: embed.author?.name ?? '',
      },
      text: embed.description ?? '',
      timestamp: embed.timestamp ? new Date(embed.timestamp) : undefined,
      url: embed.url,
      attachments: [...images, video].filter(Boolean) as MessageAttachment[],
    }
    return { tweet }
  } else {
    // general Twitter URL
    const image = embed.image ?? embed.thumbnail
    const link: MessageLink = {
      url: embed.url!,
      img: image?.proxy_url ?? image?.url,
      imgSize: image?.width && image?.height ? { width: image.width, height: image.height } : undefined,
      title: embed.title ?? '',
      summary: embed.description,
    }
    return { link }
  }
}

export const handleRichEmbed = (embed: APIEmbed, message: DiscordMessage): { text?: string, tweet?: Tweet, link?: MessageLink, attachment?: MessageAttachment } | undefined => {
  const [,, domain, path] = embed.url ? (urlRegex.exec(embed.url) ?? []) : []
  switch (domain?.toLowerCase()) {
    case 'twitter.com':
      return handleTweetEmbed(embed, message, path)
    default: {
      const final: { text?: string, link?: MessageLink, attachment?: MessageAttachment } = {}

      let text = message.content
      if (embed.title) text += `\n**${embed.title}**\n`
      if (embed.description) text += `\n${embed.description}`
      if (embed.fields && embed.fields.length > 0) {
        const fields = embed.fields.map(f => `**${f.name}**\n${f.value}`)
        text += '\n\n' + fields.join('\n\n')
      }
      final.text = text?.trim()

      if (embed.url) {
        const link: MessageLink = {
          url: embed.url,
          title: embed.title ?? '',
        }
        final.link = link
      }

      const image = embed.image ?? embed.thumbnail
      const imageURL = image?.url ?? image?.proxy_url
      if (image && imageURL) {
        const { type, isGif } = parseMediaURL(imageURL)
        const attachment: MessageAttachment = {
          id: imageURL,
          type,
          srcURL: imageURL,
          size: image.width && image.height ? { width: image.width, height: image.height } : undefined,
          isGif,
        }
        final.attachment = attachment
      }

      return final
    }
  }
}

export const handleVideoEmbed = (embed: APIEmbed): { link?: MessageLink, attachment?: MessageAttachment } => {
  if (embed.provider?.name?.toLowerCase() === 'youtube') {
    const link: MessageLink = {
      url: embed.url!,
      img: embed.thumbnail?.url,
      imgSize: embed.thumbnail?.width && embed.thumbnail?.height ? { width: embed.thumbnail.width, height: embed.thumbnail.height } : undefined,
      title: embed.title ?? '',
      summary: embed.description,
    }
    return { link }
  } else {
    const attachment: MessageAttachment = {
      id: embed.url!,
      type: MessageAttachmentType.VIDEO,
      mimeType: embed.video?.url ? mapMimeType(embed.video.url) : undefined,
      srcURL: embed.video?.url,
      size: embed.video?.width && embed.video?.height ? { width: embed.video.width, height: embed.video.height } : undefined,
    }
    return { attachment }
  }
}
