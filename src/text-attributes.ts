/**
 * An implementation of Discord text formatting.
 * https://support.discord.com/hc/en-us/articles/210298617-Markdown-Text-101-Chat-Formatting-Bold-Italic-Underline-
 */

import emojiRegex from 'emoji-regex'
import type { TextEntity } from '@textshq/platform-sdk'

const getClosingToken = (token: string): string => (token === '<' ? '>' : token)

const USER_REGEX = /^@!(\d+)$/
const EMOTE_REGEX = /^(a?):([A-Za-z0-9_]+):(\d+)$/

const isDiscordEntity = (input: string): boolean => {
  return USER_REGEX.test(input) || EMOTE_REGEX.test(input)
}

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
        curToken !== '<' ||
        isDiscordEntity(input.slice(0, closingIndex).join(''))
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

export function mapTextAttributes(src: string, getUserName: (id: string) => string) {
  if (!src) return

  const entities: TextEntity[] = []
  let output = ''
  let curToken: string = null
  let input = Array.from(src)

  // Parse the input sequentially.
  while (input.length) {
    if (curToken) {
      const closingIndex = findClosingIndex(input, curToken)
      if (closingIndex > 0) {
        // A valid closingIndex is found, it's a valid token!
        const content = input.slice(0, closingIndex).join('')
        // See if we can find nested entities.
        let nestedAttributes = { text: '', textAttributes: undefined }
        if (!['<', '`', '```'].includes(curToken)) {
          nestedAttributes = mapTextAttributes(content, getUserName)
        }
        const from = Array.from(output).length
        // Construct the entity of the current token.
        const entity: TextEntity = {
          from,
          to: from + closingIndex,
        }
        if (nestedAttributes.textAttributes) {
          // Nested entities change the output, so update the range.
          entity.to = from + nestedAttributes.text.length
          // Offset the range of child entities.
          const childEntities = nestedAttributes.textAttributes.entities.map(
            en => ({
              ...en,
              from: en.from + from,
              to: en.to + from,
            })
          )
          entities.push(...childEntities)
          output += nestedAttributes.text
        } else if (curToken === '<') {
          // Handle discord entity: mention or emoji.
          let matches = USER_REGEX.exec(content)
          if (matches) {
            const id = matches[1]
            const username = getUserName(id)
            output += `@${username}`
            entity.to = from + username.length + 1
            entity.mentionedUser = {
              id,
              username
            }
          }
        } else {
          output += content
        }
        switch (curToken) {
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
          case '*':
          case '_':
            entity.italic = true
            break
          case '~~':
            entity.strikethrough = true
            break
          case '```':
            entity.code = true
            entity.pre = true
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
      }
    }
    // Always start from the first char.
    const c1 = input[0]
    const first2 = input.slice(0, 2).join('')
    const first3 = input.slice(0, 3).join('')
    if (['***', '```'].includes(first3)) {
      curToken = first3
      input = input.slice(curToken.length)
    } else if (['**', '__', '~~'].includes(first2)) {
      curToken = first2
      input = input.slice(curToken.length)
    } else if (['*', '_', '`', '<'].includes(c1)) {
      curToken = c1
      input = input.slice(curToken.length)
    } else {
      output += c1
      input = input.slice(1)
    }
  }
  return {
    text: output,
    textAttributes: entities.length ? { entities } : undefined,
  }
}
