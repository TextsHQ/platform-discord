import { ServerEventType } from '@textshq/platform-sdk'

import { mapUser } from '../../../mappers/mappers'
import type DiscordNetworkAPI from '../../../network-api'
import { GatewayMessageType } from '../../constants'

export default function attachRecipientHandlers(api: DiscordNetworkAPI) {
  api.gatewayEvents.on(GatewayMessageType.CHANNEL_RECIPIENT_ADD, ({ d }) => {
    api.eventCallback([{
      type: ServerEventType.STATE_SYNC,
      mutationType: 'upsert',
      objectName: 'participant',
      objectIDs: {
        threadID: d.channel_id,
      },
      entries: [mapUser(d.user)],
    }])
  })

  api.gatewayEvents.on(GatewayMessageType.CHANNEL_RECIPIENT_REMOVE, ({ d }) => {
    api.eventCallback([{
      type: ServerEventType.THREAD_MESSAGES_REFRESH,
      threadID: d.channel_id,
    }])
  })
}
