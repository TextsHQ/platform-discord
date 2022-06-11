import type { TextEntity } from '@textshq/platform-sdk';
import markdown from 'simple-markdown';

interface ParseRule {
  order: number;
  match: (source: any, state: any, prevSource: any) => any | undefined;
  parse: (capture: any, parse: any, state: any) => any | undefined;
  entities: (node: any, nestedOutput: any, state: any) => any | undefined;
  html: (node: any, nestedOutput: any, state: any) => string;
}

function htmlTag(
  tagName: string,
  content: string,
  attributes: any,
  isClosed = true,
  state: any = {}
) {
  if (typeof isClosed === 'object') {
    state = isClosed;
    isClosed = true;
  }

  if (!attributes) attributes = {};

  // @ts-ignore
  if (attributes.class && state.cssModuleNames)
    // @ts-ignore
    attributes.class = attributes.class
      .split(' ')
      .map((cl: string) => state.cssModuleNames[cl] || cl)
      .join(' ');

  let attributeString = '';
  for (let attr in attributes) {
    // Removes falsy attributes
    if (
      Object.prototype.hasOwnProperty.call(attributes, attr) &&
      attributes[attr]
    )
      attributeString += ` ${markdown.sanitizeText(
        attr
      )}='${markdown.sanitizeText(attributes[attr])}'`;
  }

  let unclosedTag = `<${tagName}${attributeString}>`;

  if (isClosed) return unclosedTag + content + `</${tagName}>`;
  return unclosedTag;
}

export const newline = markdown.defaultRules.newline;
export const escape = markdown.defaultRules.escape;
export const strong = markdown.defaultRules.strong;
export const u = markdown.defaultRules.u;
export const link = markdown.defaultRules.link;

export const blockQuote: ParseRule = {
  ...markdown.defaultRules.blockQuote,
  // @ts-ignore
  match: (source, state, prevSource) => {
    return !/^$|\n *$/.test(prevSource) || state.inQuote
      ? null
      : /^( *>>> ([\s\S]*))|^( *> [^\n]*(\n *> [^\n]*)*\n?)/.exec(source);
  },
  // @ts-ignore
  parse: (capture, parse, state) => {
    const all = capture[0];
    const isBlock = Boolean(/^ *>>> ?/.exec(all));
    const removeSyntaxRegex = isBlock ? /^ *>>> ?/ : /^ *> ?/gm;
    const content = all.replace(removeSyntaxRegex, '');

    return {
      content: parse(content, { ...state, inQuote: true }),
      type: 'blockQuote',
    };
  },
  entities: (node, nestedOutput, state) => {
    markdown.defaultRules.blockQuote.html(node, nestedOutput, state);
  },
};

export const codeBlock: ParseRule = {
  ...markdown.defaultRules.codeBlock,
  match: markdown.inlineRegex(/^```(([a-z0-9-]+?)\n+)?\n*([^]+?)\n*```/i),
  // @ts-ignore
  parse: (capture, parse, state) => {
    return {
      lang: (capture[2] || '').trim(),
      content: capture[3] || '',
      inQuote: state.inQuote || false,
    };
  },
  // @ts-ignore
  makeAttribute: (node, output, state) => {
    console.log('codeBlock', node, output, state);
    let code: any;
    // if (node.lang && highlight.getLanguage(node.lang))
    // code = highlight.highlight(node.content, { language: node.lang, ignoreIllegals: true }); // Discord seems to set ignoreIllegals: true

    if (code && state.cssModuleNames)
      // Replace classes in hljs output
      // @ts-ignore
      code.value = code.value.replace(
        /<span class='([a-z0-9-_ ]+)'>/gi,
        (str: string, m: string) =>
          // @ts-ignore
          str.replace(
            m,
            m
              .split(' ')
              .map((cl: string) => state.cssModuleNames[cl] || cl)
              .join(' ')
          )
      );

    return htmlTag(
      'pre',
      htmlTag(
        // @ts-ignore
        'code',
        code ? code.value : markdown.sanitizeText(node.content),
        { class: `hljs${code ? ' ' + code.language : ''}` },
        state
      ),
      null,
      state
    );
  },
};

export const autolink: ParseRule = {
  ...markdown.defaultRules.autolink,
  // @ts-ignore
  parse: (capture) => {
    return {
      content: [
        {
          type: 'text',
          content: capture[1],
        },
      ],
      target: capture[1],
    };
  },
  // @ts-ignore
  entities: (node, output, state) => {
    console.log('autolink', node, output, state);
    return htmlTag(
      'a',
      output(node.content, state),
      { href: markdown.sanitizeUrl(node.target) },
      state
    );
  },
  html: (node, output, state) => {
    console.log('autolink', node, output, state);
    return htmlTag(
      'a',
      output(node.content, state),
      { href: markdown.sanitizeUrl(node.target) },
      state
    );
  },
};

export const url: ParseRule = {
  ...markdown.defaultRules.url,
  // @ts-ignore
  parse: (capture) => {
    return {
      content: [
        {
          type: 'text',
          content: capture[1],
        },
      ],
      target: capture[1],
    };
  },
  // @ts-ignore
  entities: (node, output, state) => {
    console.log('url', node, output, state);
    return htmlTag(
      'a',
      output(node.content, state),
      { href: markdown.sanitizeUrl(node.target) },
      state
    );
  },
  html: (node, output, state) => {
    console.log('url', node, output, state);
    return htmlTag(
      'a',
      output(node.content, state),
      { href: markdown.sanitizeUrl(node.target) },
      state
    );
  },
};

export const em: ParseRule = {
  ...markdown.defaultRules.em,
  parse: (capture, parse, state) => {
    const parsed = markdown.defaultRules.em.parse(capture, parse, {
      ...state,
      inEmphasis: true,
    });
    return state.inEmphasis ? parsed.content : parsed;
  },
  entities: (node, nestedOutput, state) => {
    markdown.defaultRules.em.html(node, nestedOutput, state);
  },
};

export const strike: ParseRule = {
  ...markdown.defaultRules.del,
  match: markdown.inlineRegex(/^~~([\s\S]+?)~~(?!_)/),
  entities: (node, nestedOutput, state) => {
    markdown.defaultRules.del.html(node, nestedOutput, state);
  },
};

export const inlineCode: ParseRule = {
  ...markdown.defaultRules.inlineCode,
  // @ts-ignore
  match: (source) => markdown.defaultRules.inlineCode.match.regex?.exec(source),
  // @ts-ignore
  entities: (node, output, state) => {
    console.log('inlineCode', node, output, state);
    return htmlTag(
      'code',
      markdown.sanitizeText(node.content.trim()),
      null,
      state
    );
  },
};

export const text: ParseRule = {
  ...markdown.defaultRules.text,
  // @ts-ignore
  match: (source) =>
    /^[\s\S]+?(?=[^0-9A-Za-z\s\u00c0-\uffff-]|\n\n|\n|\w+:\S|$)/.exec(source),
  // @ts-ignore
  entities: (node, output, state) => {
    console.log('text', node, output, state);
    if (state.escapeHTML) return markdown.sanitizeText(node.content);
    return node.content;
  },
};

export const emote: ParseRule = {
  order: markdown.defaultRules.text.order,
  // @ts-ignore
  match: (source) => /^(¯\\_\(ツ\)_\/¯)/.exec(source),
  // @ts-ignore
  parse: (capture) => {
    return {
      type: 'text',
      content: capture[1],
    };
  },
  // @ts-ignore
  entities: (node, output, state) => {
    console.log('emote', node, output, state);
    return output(node.content, state);
  },
  html: (node, output, state) => {
    console.log('emote', node, output, state);
    return output(node.content, state);
  },
};

export const br: ParseRule = {
  ...markdown.defaultRules.br,
  match: markdown.anyScopeRegex(/^\n/),
  entities: (node, nestedOutput, state) => {
    markdown.defaultRules.br.html(node, nestedOutput, state);
  },
};

export const spoiler: ParseRule = {
  order: 0,
  // @ts-ignore
  match: (source) => /^\|\|([\s\S]+?)\|\|/.exec(source),
  // @ts-ignore
  parse: (capture, parse, state) => {
    return {
      content: parse(capture[1], state),
    };
  },
  // @ts-ignore
  entities: (node, output, state) => {
    console.log('spoiler', node, output, state);
    return htmlTag(
      'span',
      output(node.content, state),
      { class: 'd-spoiler' },
      state
    );
  },
  html: (node, output, state) => {
    console.log('spoiler', node, output, state);
    return htmlTag(
      'span',
      output(node.content, state),
      { class: 'd-spoiler' },
      state
    );
  },
};

export const discordUser: ParseRule = {
  order: markdown.defaultRules.strong.order,
  // @ts-ignore
  match: (source) => /^<@!?([0-9]*)>/.exec(source),
  // @ts-ignore
  parse: (capture) => {
    return {
      id: capture[1],
    };
  },
  // @ts-ignore
  entities: (node, output, state) => {
    console.log('discordUser', node, output, state);
    return htmlTag(
      'span',
      state.discordCallback.user(node),
      { class: 'd-mention d-user' },
      state
    );
  },
  html: (node, output, state) => {
    console.log('discordUser', node, output, state);
    return htmlTag(
      'span',
      state.discordCallback.user(node),
      { class: 'd-mention d-user' },
      state
    );
  },
};

export const discordChannel: ParseRule = {
  order: markdown.defaultRules.strong.order,
  // @ts-ignore
  match: (source) => /^<#?([0-9]*)>/.exec(source),
  // @ts-ignore
  parse: (capture) => {
    return {
      id: capture[1],
    };
  },
  // @ts-ignore
  entities: (node, output, state) => {
    console.log('discordChannel', node, output, state);
    return htmlTag(
      'span',
      state.discordCallback.channel(node),
      { class: 'd-mention d-channel' },
      state
    );
  },
  html: (node, output, state) => {
    console.log('discordChannel', node, output, state);
    return htmlTag(
      'span',
      state.discordCallback.channel(node),
      { class: 'd-mention d-channel' },
      state
    );
  },
};

export const discordRole: ParseRule = {
  order: markdown.defaultRules.strong.order,
  // @ts-ignore
  match: (source) => /^<@&([0-9]*)>/.exec(source),
  // @ts-ignore
  parse: (capture) => {
    return {
      id: capture[1],
    };
  },
  // @ts-ignore
  entities: (node, output, state) => {
    console.log('discordRole', node, output, state);
    return htmlTag(
      'span',
      state.discordCallback.role(node),
      { class: 'd-mention d-role' },
      state
    );
  },
  html: (node, output, state) => {
    console.log('discordRole', node, output, state);
    return htmlTag(
      'span',
      state.discordCallback.role(node),
      { class: 'd-mention d-role' },
      state
    );
  },
};

export const discordEmoji: ParseRule = {
  order: markdown.defaultRules.strong.order,
  // @ts-ignore
  match: (source) => /^<(a?):(\w+):(\d+)>/.exec(source),
  // @ts-ignore
  parse: (capture) => {
    return {
      animated: capture[1] === 'a',
      name: capture[2],
      id: capture[3],
    };
  },
  // @ts-ignore
  entities: (node, output, state) => {
    console.log('discordEmoji', node, output, state);
    return htmlTag(
      'img',
      '',
      {
        class: `d-emoji${node.animated ? ' d-emoji-animated' : ''}`,
        src: `https://cdn.discordapp.com/emojis/${node.id}.${
          node.animated ? 'gif' : 'png'
        }`,
        alt: `:${node.name}:`,
      },
      false,
      state
    );
  },
  html: (node, output, state) => {
    console.log('discordEmoji', node, output, state);
    return htmlTag(
      'img',
      '',
      {
        class: `d-emoji${node.animated ? ' d-emoji-animated' : ''}`,
        src: `https://cdn.discordapp.com/emojis/${node.id}.${
          node.animated ? 'gif' : 'png'
        }`,
        alt: `:${node.name}:`,
      },
      false,
      state
    );
  },
};

export const discordEveryone: ParseRule = {
  order: markdown.defaultRules.strong.order,
  // @ts-ignore
  match: (source) => /^@everyone/.exec(source),
  parse: () => {
    return {};
  },
  // @ts-ignore
  entities: (node, output, state) => {
    console.log('discordEveryone', node, output, state);
    return htmlTag(
      'span',
      state.discordCallback.everyone(node),
      { class: 'd-mention d-user' },
      state
    );
  },
  html: (node, output, state) => {
    console.log('discordEveryone', node, output, state);
    return htmlTag(
      'span',
      state.discordCallback.everyone(node),
      { class: 'd-mention d-user' },
      state
    );
  },
};

export const discordHere: ParseRule = {
  order: markdown.defaultRules.strong.order,
  // @ts-ignore
  match: (source) => /^@here/.exec(source),
  parse: () => {
    return {};
  },
  // @ts-ignore
  entities: (node, output, state) => {
    console.log('discordHere', node, output, state);
    return htmlTag(
      'span',
      state.discordCallback.here(node),
      { class: 'd-mention d-user' },
      state
    );
  },
  html: (node, output, state) => {
    console.log('discordHere', node, output, state);
    return htmlTag(
      'span',
      state.discordCallback.here(node),
      { class: 'd-mention d-user' },
      state
    );
  },
};

export const rules: markdown.ParserRules = {
  newline,
  escape,
  strong,
  u,
  link,
  blockQuote,
  codeBlock,
  autolink,
  url,
  em,
  strike,
  inlineCode,
  text,
  emote,
  br,
  spoiler,
  discordUser,
  discordChannel,
  discordRole,
  discordEmoji,
  discordEveryone,
  discordHere,
};
