//
// Based on https://github.com/brussell98/discord-markdown
//

/*  htmlTag -> TextAttributes
 */

import { parserFor, outputFor } from 'simple-markdown';
import makeEntities from './entities';
import { rules } from './rules';

const discordCallbackDefaults = {
  // @ts-ignore
  user: (node) => '@' + markdown.sanitizeText(node.id),
  // @ts-ignore
  channel: (node) => '#' + markdown.sanitizeText(node.id),
  // @ts-ignore
  role: (node) => '&' + markdown.sanitizeText(node.id),
  everyone: () => '@everyone',
  here: () => '@here',
};

// @ts-ignore
export function parse(
  source: any,
  callbacks: {
    getUserName: (id: string) => string | undefined;
  }
) {
  const options = {
    embed: true,
    escapeHTML: true,
    discordCallback: {},
  };

  const parser = parserFor(rules);
  // @ts-ignore
  const output = outputFor(rules, 'entities');

  const state = {
    inline: true,
    inQuote: false,
    inEmphasis: false,
    escapeHTML: options.escapeHTML,
    cssModuleNames: null,
    discordCallback: {
      ...discordCallbackDefaults,
      ...options.discordCallback,
    },
  };

  // const nodes = parser(source, state)
  // return makeEntities(nodes)
  return output(parser(source, state), state);
}
