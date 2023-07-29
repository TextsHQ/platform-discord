import { Message } from '@/types/Discord/Message'

export * as Ack from './ack'

export type Request = {
  content?: string
  message_reference?: {
    message_id?: string
  }
  nonce?: string
}

export namespace Response {
  export type GET = Message[]
  export type POST = Message
}
