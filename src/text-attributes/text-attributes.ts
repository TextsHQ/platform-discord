//
// Based on https://github.com/brussell98/discord-markdown
//

import type { AttributedText } from '@textshq/platform-sdk'
import { parserFor, outputFor, State } from 'simple-markdown'
import { rules } from './rules'

export interface ParserState extends State {
  inline: boolean;
  inQuote: boolean;
  inEmphasis: boolean;
  offset: number;
  fullText: string;
  nested: boolean;
  discordCallbacks: {
    getUserName: (id: string) => string | undefined
  };
}

export function parse(
  source: string,
  callbacks: {
    getUserName: (id: string) => string | undefined
  },
): AttributedText {
  const parser = parserFor(rules)
  // @ts-expect-error
  const output = outputFor(rules, 'attributedText')

  const state: ParserState = {
    inline: true,
    inQuote: false,
    inEmphasis: false,
    offset: 0,
    fullText: "",
    nested: false,
    discordCallbacks: callbacks,
  }

  return output(parser(source, state), state)
}
