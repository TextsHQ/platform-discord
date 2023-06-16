import { APIUser } from "discord-api-types/v10";

export type _APIUser = APIUser & {
  global_name?: string;
}
