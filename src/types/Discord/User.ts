export type User = {
  // user ID
  id: string
  // actual user name
  username: string
  // display name
  global_name?: string
  avatar: string
  discriminator: string
  // public_flags: number
  // avatar_decoration?: any

  // nitro? not sure
  premium?: boolean
  premium_type?: number
}
