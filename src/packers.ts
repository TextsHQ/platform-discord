import type Erlpack from 'erlpack'

let erlpack: typeof Erlpack

try {
  erlpack = require('erlpack')
} catch (err) {
  // swallow
}

export const etfPacker = {
  encoding: 'etf',
  pack: erlpack?.pack,
  unpack: erlpack?.unpack,
}

export const jsonPacker = {
  encoding: 'json',
  pack: JSON.stringify,
  unpack: (data: Buffer) => {
    const ab = new TextDecoder()
    const str = typeof data !== 'string' ? ab.decode(data) : data
    return JSON.parse(str)
  },
}

export const defaultPacker = erlpack ? etfPacker : jsonPacker
