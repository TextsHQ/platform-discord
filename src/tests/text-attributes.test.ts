import { parse } from '../text-attributes/text-attributes'

const flatCases = [
  {
    text: '**bold** _italic_ *italic* __underline__ ~~strikethrough~~',
    result: {
      text: 'bold italic italic underline strikethrough',
      textAttributes: {
        entities: [
          {
            from: 0,
            to: 4,
            bold: true,
          },
          {
            from: 5,
            to: 11,
            italic: true,
          },
          {
            from: 12,
            to: 18,
            italic: true,
          },
          {
            from: 19,
            to: 28,
            underline: true,
          },
          {
            from: 29,
            to: 42,
            strikethrough: true,
          },
        ],
      },
    },
  },
  {
    text: '**it*',
    result: {
      text: '*it',
      textAttributes: {
        entities: [
          {
            from: 1,
            to: 3,
            italic: true,
          },
        ],
      },
    },
  },
  {
    text: '*abc*🤔 **xyz** 123',
    result: {
      text: 'abc🤔 xyz 123',
      textAttributes: {
        entities: [
          {
            from: 0,
            to: 3,
            italic: true,
          },
          {
            from: 5,
            to: 8,
            bold: true,
          },
        ],
      },
    },
  },
  {
    text: 'Test _漢字_ **世界** 12',
    result: {
      text: 'Test 漢字 世界 12',
      textAttributes: {
        entities: [
          {
            from: 5,
            to: 7,
            italic: true,
          },
          {
            from: 8,
            to: 10,
            bold: true,
          },
        ],
      },
    },
  },
  {
    text: 'Inline ` code ` should work',
    result: {
      text: 'Inline  code  should work',
      textAttributes: {
        entities: [
          {
            from: 7,
            to: 13,
            code: true,
          },
        ],
      },
    },
  },
  {
    text: '```code``` and ```\n  block\nshould work\n``` as well',
    result: {
      text: 'code and \n  block\nshould work\n as well',
      textAttributes: {
        entities: [
          {
            from: 0,
            to: 4,
            code: true,
            pre: true,
          },
          {
            from: 9,
            to: 30,
            code: true,
            pre: true,
          },
        ],
      },
    },
  },
  {
    text: 'a <@!1234> b',
    result: {
      text: 'a @user1 b',
      textAttributes: {
        entities: [
          {
            from: 2,
            to: 8,
            mentionedUser: {
              id: '1234',
              username: 'user1',
            },
          },
        ],
      },
    },
  },
  {
    text: 'a <a:pika:123> b',
    result: {
      text: 'a :pika: b',
      textAttributes: {
        entities: [
          {
            from: 2,
            to: 8,
            replaceWithMedia: {
              mediaType: 'img',
              srcURL: 'https://cdn.discordapp.com/emojis/123.gif',
              size: {
                width: 16,
                height: 16,
              },
            },
          },
        ],
      },
    },
  },
]

const nestedCases = [
  {
    text:
      '***bold-italic*** __*under-italic*__ __**under-bold**__ __***under-bold-italic***__',
    result: {
      text: 'bold-italic under-italic under-bold under-bold-italic',
      textAttributes: {
        entities: [
          {
            from: 0,
            to: 11,
            bold: true,
            italic: true,
          },
          {
            from: 12,
            to: 24,
            italic: true,
          },
          {
            from: 12,
            to: 24,
            underline: true,
          },
          {
            from: 25,
            to: 35,
            bold: true,
          },
          {
            from: 25,
            to: 35,
            underline: true,
          },
          {
            from: 36,
            to: 53,
            bold: true,
            italic: true,
          },
          {
            from: 36,
            to: 53,
            underline: true,
          },
        ],
      },
    },
  },
  {
    text: 'x **b _it_ ~~st~~**',
    result: {
      text: 'x b it st',
      textAttributes: {
        entities: [
          {
            from: 4,
            to: 6,
            italic: true,
          },
          {
            from: 7,
            to: 9,
            strikethrough: true,
          },
          {
            from: 2,
            to: 9,
            bold: true,
          },
        ],
      },
    },
  },
]

const cases = [flatCases, nestedCases].flat()

const getUserName = (id: string): string | undefined => {
  return { 1234: 'user1' }[id]
}

test('text attributes', () => {
  for (const c of cases) {
    expect(parse(c.text, { getUserName })).toEqual(c.result)
  }
})
