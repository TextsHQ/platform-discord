//
// Based on https://github.com/brussell98/discord-markdown
//

import type { TextAttributes } from '@textshq/platform-sdk'
import { parserFor, outputFor } from 'simple-markdown'
import { rules } from './rules'

export function parse(
  source: string,
  callbacks: {
    getUserName: (id: string) => string | undefined
  },
): TextAttributes {
  const parser = parserFor(rules)
  // @ts-expect-error
  const output = outputFor(rules, 'textEntities')

  const state = {
    inline: true,
    inQuote: false,
    inEmphasis: false,
    offset: 0,
    nested: false,
    discordCallbacks: callbacks,
  }

  return output(parser(source, state), state)
}
