/**
 * An implementation of Discord text formatting.
 * https://support.discord.com/hc/en-us/articles/210298617-Markdown-Text-101-Chat-Formatting-Bold-Italic-Underline-
 */

import type { TextAttributes, TextEntity } from '@textshq/platform-sdk'
import { getEmojiURL } from './util'

const TOKENS = {
  1: ['*', '_', '`', '<'],
  2: ['**', '__', '~~', '||'],
  3: ['***', '```'],
}

const getClosingToken = (token: string): string => (token === '<' ? '>' : token)

// A mention can be
//   - <@!1234> or <@1234> for user mention
//   - <@&1234> for role mention
//   - <#1234> for channel mention
// See https://discordjs.guide/miscellaneous/parsing-mention-arguments.html#how-discord-mentions-work.
// const MENTION_REGEX = /^(?:@!?|@&|#)(\d+)$/
// We are only handling user mention here.
const USER_REGEX = /^@!?(\d+)$/
const EMOTE_REGEX = /^(a?):([A-Za-z0-9_]+):(\d+)$/

const isDiscordEntity = (input: string): boolean => (USER_REGEX.test(input) || EMOTE_REGEX.test(input))

/**
 * Try to find the closing index for curToken.
 */
const findClosingIndex = (input: string[], curToken: string) => {
  const closingToken = getClosingToken(curToken)
  const tokenLen = closingToken.length
  let closingIndex = input.indexOf(closingToken[0])
  while (closingIndex > -1) {
    let tokenMatched = true
    for (let i = 1; i < tokenLen; i++) {
      // When token has more than one char, make sure the chars after the
      // closingIndex fully match token.
      if (input[closingIndex + i] !== closingToken[i]) {
        tokenMatched = false
        break
      }
    }
    if (tokenMatched) {
      if (
        curToken !== '<'
        || isDiscordEntity(input.slice(0, closingIndex).join(''))
      ) {
        return closingIndex
      }
      return -1
    }
    // If not fully matched, find the next closingIndex
    closingIndex = input.indexOf(closingToken[0], closingIndex + 1)
  }
  return closingIndex
}

type MappedTextAttributes = { text: string | undefined, textAttributes: TextAttributes | undefined }

export function mapTextAttributes(src: string, getUserName: (id: string) => string | undefined): MappedTextAttributes | undefined {
  if (!src) return

  const entities: TextEntity[] = []
  let output = ''
  let curToken: string | null = null
  let input = Array.from(src)

  // Parse the input sequentially.
  while (input.length) {
    if (curToken) {
      const closingIndex = findClosingIndex(input, curToken)
      if (closingIndex > 0) {
        // A valid closingIndex is found, it's a valid token!
        const content = input.slice(0, closingIndex).join('') // .replace(/^\s+|\s+$/g, '')
        // See if we can find nested entities.
        let nestedAttributes: MappedTextAttributes | undefined = { text: undefined, textAttributes: undefined }
        if (!['<', '`', '```'].includes(curToken)) {
          nestedAttributes = mapTextAttributes(content, getUserName)
        }
        const from = Array.from(output).length
        // Construct the entity of the current token.
        const entity: TextEntity = {
          from,
          to: from + closingIndex,
        }
        if (nestedAttributes?.textAttributes) {
          // Nested entities change the output, so update the range.
          entity.to = from + (nestedAttributes.text?.length ?? 0)
          // Offset the range of child entities.
          const childEntities = nestedAttributes.textAttributes.entities?.map(en => ({ ...en, from: en.from + from, to: en.to + from }))
          if (childEntities) entities.push(...childEntities)
          output += nestedAttributes.text
        } else if (curToken === '<') {
          // Handle discord entity: mention or emoji.
          let matches = USER_REGEX.exec(content)
          if (matches) {
            const id = matches[1]
            const username = getUserName(id)
            if (username) {
              output += `@${username}`
              entity.to = from + [...username].length + 1
              entity.mentionedUser = {
                id,
                username,
              }
            }
          // eslint-disable-next-line no-cond-assign
          } else if (matches = EMOTE_REGEX.exec(content)) {
            const [matched, animated, name, id] = matches
            output += `:${name}:`
            entity.to = from + name.length + 2
            entity.replaceWithMedia = {
              mediaType: 'img',
              srcURL: getEmojiURL(id, !!animated),
              size: {
                width: matched.length === (src.length - 2) ? 64 : 16,
                height: matched.length === (src.length - 2) ? 64 : 16,
              },
            }
          }
        } else {
          output += content
        }
        switch (curToken) {
          case '```':
            entity.codeLanguage = input.slice(0, input.indexOf('\n')).join('')
            entity.code = true
            entity.pre = true
            break
          case '***':
            entity.bold = true
            entity.italic = true
            break
          case '**':
            entity.bold = true
            break
          case '__':
            entity.underline = true
            break
          case '~~':
            entity.strikethrough = true
            break
          case '||':
            entity.spoiler = true
            break
          case '*':
          case '_':
            entity.italic = true
            break
          case '`':
            entity.code = true
            break
          case '<':
            // Already handled above.
            break
        }
        entities.push(entity)
        input = input.slice(closingIndex + curToken.length)
        curToken = null
        continue
      } else {
        // Unable to find a valid closingIndex, add the first char to the
        // output, push the remainging back to input.
        output += curToken[0]
        input.unshift(...curToken.slice(1))
        curToken = null
      }
    }

    // Always start from the first char.
    let token = input.slice(0, 3).join('')
    if (TOKENS[3].includes(token)) {
      curToken = token
      input = input.slice(3)
    // eslint-disable-next-line no-sequences
    } else if (token = input.slice(0, 2).join(''), TOKENS[2].includes(token)) {
      curToken = token
      input = input.slice(2)
    // eslint-disable-next-line no-sequences
    } else if (token = input[0], TOKENS[1].includes(token)) {
      curToken = token
      input = input.slice(1)
    } else {
      output += input[0]
      input = input.slice(1)
    }
  }
  return {
    text: output,
    textAttributes: entities.length ? { entities } : undefined,
  }
}
