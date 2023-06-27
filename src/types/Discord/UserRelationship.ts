import { User } from './User'

export interface UserRelationship {
  id: string
  type: UserRelationshipType
  nickname?: string
  user: User
  // since: string
}

export enum UserRelationshipType {
  FRIENDS = 1,
}
