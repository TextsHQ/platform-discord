import EventEmitter from 'node:events'

import type { EventData, DispatchMessage, GatewayMessage } from './types'

type Events = {
  error: (error: any) => void

  // This event is disptached for every Gateway message we get. If the event in
  // question has a known type shape in `EventData`, that is _also_ emitted.
  // Prefer that event for stronger guarantees.
  message: (message: GatewayMessage) => void
} &
  // Transforms every known event data payload into a handler type for our
  // event emitter.
  { [MessageType in keyof EventData]: (message: DispatchMessage<MessageType>) => void }

/// A thin wrapper around {@link EventEmitter} for more accurate types.
export default class GatewayEventEmitter {
  private emitter = new EventEmitter({ captureRejections: true })

  on<Event extends keyof Events>(event: Event, handler: Events[Event]) {
    this.emitter.on(event, handler)
  }

  emit<Event extends keyof Events>(event: Event, ...data: Parameters<Events[Event]>) {
    this.emitter.emit(event, ...data)
  }
}
