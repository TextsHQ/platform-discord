import zlib from 'zlib'
import type { Data as WSData } from 'ws'
import type Erlpack from 'erlpack'

let erlpack: typeof Erlpack | undefined
try {
  erlpack = require('erlpack')
} catch {
  // swallow
}

export type Packer = {
  encoding: string
  pack: (data: any) => any
  unpack: (data: WSData) => any
}

export const etfPacker: Packer = {
  encoding: 'etf',
  pack: erlpack?.pack,
  unpack: erlpack?.unpack,
}

const COMPRESS_JSON = false
export const jsonPacker: Packer = {
  encoding: 'json',
  pack: JSON.stringify,
  unpack: (data: string | Buffer) => {
    // const str = decodeData(data)
    if (typeof data === 'string') return data
    const buffer = COMPRESS_JSON ? zlib.deflateSync(data) : data
    const ab = new TextDecoder()
    return JSON.parse(ab.decode(buffer))
  },
}

export const defaultPacker = erlpack ? etfPacker : jsonPacker
export const usesErlpack = !!erlpack
