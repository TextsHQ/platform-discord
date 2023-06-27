import { Channel } from '@/types/Discord'

export * as Messages from './messages'

export type Request = Partial<Channel>

export type Response = Channel
