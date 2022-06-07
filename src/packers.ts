import zlib from 'zlib'
import { texts } from '@textshq/platform-sdk'
import type { Data as WSData } from 'ws'
import type Erlpack from 'erlpack'

let erlpack: typeof Erlpack | undefined
try {
  erlpack = require('erlpack')
  texts.log('[discord] erlpack loaded')
} catch (error) {
  texts.error(error)
}

export type Packer = {
  encoding: string
  compress: boolean
  pack: (data: any) => any
  unpack: (data: any) => any
}

// TODO: Support compression
const etfPacker: Packer | undefined = erlpack ? {
  encoding: 'etf',
  compress: false,
  pack: erlpack.pack,
  unpack: erlpack.unpack
} : undefined

const COMPRESS_JSON = false
const jsonPacker: Packer = {
  encoding: 'json',
  compress: COMPRESS_JSON,
  pack: JSON.stringify,
  unpack: (data: WSData) => {
    // const str = decodeData(data)
    if (typeof data === 'string') return data
    const buffer = COMPRESS_JSON ? zlib.deflateSync(data as zlib.InputType) : data
    const ab = new TextDecoder()
    return JSON.parse(ab.decode(buffer as BufferSource))
  },
}

export const defaultPacker = erlpack ? etfPacker : jsonPacker
export const usesErlpack = !!erlpack
