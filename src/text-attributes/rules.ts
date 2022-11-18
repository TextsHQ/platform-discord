import type { AttributedText, TextEntity } from '@textshq/platform-sdk'
import markdown, { anyScopeRegex, blockRegex, inlineRegex } from 'simple-markdown'
import { getEmojiURL } from '../util'

// TODO: Handle nesting in rules

interface ParsedTextEntity extends TextEntity {
  ignore?: boolean;
  type?: string;
}

interface ParserRule extends markdown.SingleNodeParserRule {
  parse: (capture: markdown.Capture, parse: markdown.Parser, state: markdown.State) => ParsedTextEntity
}

function updateState(capture: markdown.Capture, state: markdown.State, replaceWith?: string): markdown.State {
  const [captured, content] = capture
  const finalContent = replaceWith ?? content ?? captured
  if (!finalContent) return state
  state.offset += [...finalContent].length
  state.fullText += finalContent

  return state
}

const parserRules: { [key: string]: ParserRule } = {
  text: {
    ...markdown.defaultRules.text,
    parse: (capture, parse, state) => {
      const oldOffset = state.offset
      state = updateState(capture, state)

      const [captured] = capture

      return {
        from: oldOffset,
        to: state.offset,
        replaceWith: captured,
        ignore: true
      }
    },
  },

  // escape: {
  //   ...markdown.defaultRules.escape,
  //   parse: (capture, parse, state) => {
  //     return { content: '' }
  //   },
  // }

  // newLine: {
  //   ...markdown.defaultRules.newline,
  //   parse: (capture, parse, state) => {
  //     return { content: '' }
  //   },
  // }

  // br: {
  //   ...markdown.defaultRules.br,
  //   parse: (capture, parse, state) => {
  //     return { content: '' }
  //   },
  // }

  strong: {
    ...markdown.defaultRules.strong,
    parse: (capture, parse, state) => {
      const oldOffset = state.offset
      state = updateState(capture, state)

      const [, text] = capture

      return {
        from: oldOffset,
        to: state.offset,
        // replaceWith: text,
        bold: true,
      }
    },
  },

  u: {
    ...markdown.defaultRules.u,
    parse: (capture, parse, state) => {
      const oldOffset = state.offset
      state = updateState(capture, state)

      const [, text] = capture

      return {
        from: oldOffset,
        to: state.offset,
        // replaceWith: text,
        underline: true,
      }
    },
  },

  em: {
    ...markdown.defaultRules.em,
    parse: (capture, parse, state) => {
      const [, textUnderline, textAsterisk] = capture
      const oldOffset = state.offset

      const replaceWith = textUnderline ?? textAsterisk

      state = updateState(capture, state, replaceWith)

      return {
        from: oldOffset,
        to: state.offset,
        // replaceWith: textUnderline ?? textAsterisk,
        italic: true,
      }
    },
  },

  strike: {
    ...markdown.defaultRules.del,
    parse: (capture, parse, state) => {
      const oldOffset = state.offset
      state = updateState(capture, state)

      const [, text] = capture

      return {
        from: oldOffset,
        to: state.offset,
        // replaceWith: text,
        strikethrough: true,
      }
    },
  },

  link: {
    ...markdown.defaultRules.link,
    parse: (capture, parse, state) => {
      const oldOffset = state.offset
      state = updateState(capture, state)

      const [link] = capture

      return {
        from: oldOffset,
        to: state.offset,
        link,
      }
    },
  },

  autolink: {
    ...markdown.defaultRules.autolink,
    parse: (capture, parse, state) => {
      const oldOffset = state.offset
      state = updateState(capture, state)

      const [link] = capture

      return {
        from: oldOffset,
        to: state.offset,
        link,
      }
    },
  },

  url: {
    ...markdown.defaultRules.url,
    parse: (capture, parse, state) => {
      const oldOffset = state.offset
      state = updateState(capture, state)

      const [link] = capture

      return {
        from: oldOffset,
        to: state.offset,
        link,
      }
    },
  },

  blockQuote: {
    ...markdown.defaultRules.blockQuote,
    match: markdown.inlineRegex(/^( *)?> (.*)/),
    parse: (capture, parse, state) => {
      const oldOffset = state.offset
      const newState = updateState(capture, state)
      state = {
        ...newState,
        offset: newState.offset + 1,
      }

      const [,, text] = capture

      return {
        from: oldOffset,
        to: state.offset,
        replaceWith: text,
        quote: true,
      }
    },
  },

  inlineCode: {
    ...markdown.defaultRules.inlineCode,
    order: 2,
    // match: inlineRegex(/^(`[^\n`]+`)/gi),  // TODO: Match escaped backticks
    parse: (capture, parse, state) => {
      const [matched,, content] = capture
      const oldOffset = state.offset
      state = updateState(capture, state, content)

      return {
        from: oldOffset,
        to: state.offset,
        // replaceWith: text,
        code: true,
      }
    },
  },

  codeBlock: {
    ...markdown.defaultRules.codeBlock,
    order: 1,
    match: anyScopeRegex(/(?:```([^(```)\n]*)```)|(?:```([a-zA-Z0-9]*)([^```]*)```)/gim),
    parse: (capture, parse, state) => {
      const [matched, inlineContent, codeLanguage, multilineContent] = capture
      const oldOffset = state.offset

      const replacedContent = inlineContent || multilineContent
      state = updateState(capture, state, replacedContent)

      return {
        from: oldOffset,
        to: state.offset,
        code: true,
        pre: true,
        codeLanguage: !!codeLanguage ? codeLanguage : undefined
      }
    },
  },

  spoiler: {
    order: 0,
    match: source => /^\|\|([\s\S]+?)\|\|/.exec(source),
    parse: (capture, parse, state) => {
      const oldOffset = state.offset
      state = updateState(capture, state)

      const [, text] = capture

      return {
        from: oldOffset,
        to: state.offset,
        replaceWith: text,
        spoiler: true,
      }
    },
  },

  discordEmoji: {
    order: markdown.defaultRules.strong.order,
    match: source => /^<(a?):(\w+):(\d+)>/.exec(source),
    parse: (capture, parse, state) => {
      const [, animatedPrefix, name, id] = capture
      const emojiURL = getEmojiURL(id, animatedPrefix === 'a')
      const oldOffset = state.offset

      const replacedContent = `:${name}:`
      state = updateState(capture, state, replacedContent)

      return {
        from: oldOffset,
        to: state.offset,
        replaceWithMedia: {
          mediaType: 'img',
          srcURL: emojiURL,
          size: {
            width: 16,
            height: 16,
          },
        },
      }
    },
  },

  discordUser: {
    order: markdown.defaultRules.strong.order,
    match: source => /^<@!?([0-9]*)>/.exec(source),
    parse: (capture, parse, state) => {
      const [, userID] = capture
      const username = state.discordCallbacks.getUserName(userID)
      const oldOffset = state.offset

      const replacedContent = `@${username}`
      state = updateState(capture, state, replacedContent)

      return {
        from: oldOffset,
        to: state.offset,
        // replaceWith: ,
        mentionedUser: {
          username,
          id: userID,
        },
      }
    },
  },

  // const ruleDiscordRole: ParserRule = {
  //   order: markdown.defaultRules.strong.order,
  //   match: source => /^<@&([0-9]*)>/.exec(source),
  //   // parse: capture => ({ id: capture[1] }),
  //   parse: (capture, parse, state) => {
  //     console.log(RuleType.discordRole, capture, state)
  //     return { content: '' }
  //   },
  // }

  // const ruleDiscordChannel: ParserRule = {
  //   order: markdown.defaultRules.strong.order,
  //   match: source => /^<#?([0-9]*)>/.exec(source),
  //   // parse: capture => ({ id: capture[1] }),
  //   parse: (capture, parse, state) => {
  //     console.log(RuleType.discordChannel, capture, state)
  //     return { content: '' }
  //   },
  // }

  // const ruleDiscordEveryone: ParserRule = {
  //   order: markdown.defaultRules.strong.order,
  //   match: source => /^@everyone/.exec(source),
  //   // parse: () => ({}), // TODO: @everyone
  //   parse: (capture, parse, state) => {
  //     console.log(RuleType.discordEveryone, capture, state)
  //     return { content: '' }
  //   },
  // }

  // const ruleDiscordHere: ParserRule = {
  //   order: markdown.defaultRules.strong.order,
  //   match: source => /^@here/.exec(source),
  //   // parse: () => ({}), // TODO: @here
  //   parse: (capture, parse, state) => {
  //     console.log(RuleType.discordHere, capture, state)
  //     return { content: '' }
  //   },
  // }
}

function attributedTextJoiner(nodes: Array<markdown.SingleASTNode>, nestedOutput: markdown.Output<TextEntity>, state: markdown.State): AttributedText {
    // TODO: Handle `nestedOutput` and `state`
  const entities = (nodes as unknown as ParsedTextEntity[])
    .filter(n => !n.ignore)
    .map(n => ({
      ...n,
      type: ["strong", "em", "u", "strike", "inlineCode", "codeBlock", "discordUser", "discordEmoji"].includes(n.type ?? "") ? undefined : n.type
    }))

  return {
    text: state.fullText,
    attributes: {
      entities
      // heDecode: false,
    }
  }
}

export const rules: markdown.ParserRules = {
  Array: {
    attributedText: attributedTextJoiner,
  },
  ...parserRules,
}