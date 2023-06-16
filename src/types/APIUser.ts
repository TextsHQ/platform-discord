import { APIUser } from 'discord-api-types/v9'

export type _APIUser = APIUser & {
  global_name?: string
}
