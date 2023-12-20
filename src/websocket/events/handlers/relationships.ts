import { mapUser } from '../../../mappers/mappers'
import type DiscordNetworkAPI from '../../../network-api'
import { GatewayMessageType } from '../../constants'

export default function attachRelationshipHandlers(api: DiscordNetworkAPI) {
  api.gatewayEvents.on(GatewayMessageType.RELATIONSHIP_ADD, ({ d }) => {
    if (!api.userFriends.find(f => f.id === d.id)) {
      const user = mapUser(d.user)
      api.userFriends.push(user)
    }
  })

  api.gatewayEvents.on(GatewayMessageType.RELATIONSHIP_REMOVE, ({ d }) => {
    const index = api.userFriends.findIndex(f => f.id === d.id)
    if (index >= 0) api.userFriends.splice(index, 1)
  })
}
