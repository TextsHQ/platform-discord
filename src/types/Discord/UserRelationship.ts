import { User } from '@/types/Discord'

export enum UserRelationshipType {
  FRIENDS = 1,
}

export type UserRelationship = {
  id: string
  type: UserRelationshipType
  nickname?: string
  user: User
  // since: string
}
