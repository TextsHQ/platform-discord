export enum StickerType {
  PNG = 1,
  APNG = 2,
  LOTTIE = 3,
  GIF,
}

export type Sticker = {
  name: string
  id: string
  format_type: StickerType
}
