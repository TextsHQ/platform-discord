import zlib from 'zlib'
import type WebSocket from 'ws'
import type Erlpack from 'erlpack'

let erlpack: typeof Erlpack

try {
  erlpack = require('erlpack')
} catch (err) {
  // swallow
}

export type Packer = {
  encoding: string
  pack: (data: any) => any
  unpack: (data: WebSocket.Data) => any
}

export const etfPacker: Packer = {
  encoding: 'etf',
  pack: erlpack?.pack,
  unpack: erlpack?.unpack,
}

export const jsonPacker: Packer = {
  encoding: 'json',
  pack: JSON.stringify,
  unpack: (data: string | Buffer) => {
    const str = decodeData(data)
    return JSON.parse(str)
  },
}

const COMPRESS_JSON = false
function decodeData(data: string | Buffer) {
  if (typeof data === 'string') return data
  const buffer = COMPRESS_JSON ? zlib.deflateSync(data) : data
  const ab = new TextDecoder()
  return ab.decode(buffer)
}

export const defaultPacker = erlpack ? etfPacker : jsonPacker
export const usesErlpack = !!erlpack
