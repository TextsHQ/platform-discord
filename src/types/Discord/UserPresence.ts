export enum UserPresenceStatus {
  Online = 'online',
  DND = 'dnd',
  Idle = 'idle',
  Invisible = 'invisible',
  Offline = 'offline',
}

export interface UserPresenceActivity {
  // type: 4,
  // timestamps: [Object],
  state: string
  name: 'Custom Status'
  // id: 'custom'
  // emoji: [Object],
  created_at: number
}

export interface UserPresence {
  // activities: []
  // broadcast?: any
  // client_status: {}
  last_modified: string | number
  status: UserPresenceStatus
  user_id: string
  client_status?: {
    desktop?: UserPresenceStatus
    mobile?: UserPresenceStatus
  }
  activities: UserPresenceActivity[]
}
