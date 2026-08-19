import { api, USE_MOCK } from './index'
import { MockRoomTransport } from './mock'
import { RoomSocket, type RoomSocketHandlers, type RoomTransport } from './roomSocket'

// picks the real WS transport or the in-memory mock stand-in depending on
// the dev-only VITE_API_MOCK switch - callers (chat/post composables) don't
// need to know which one they got.
export function createRoomTransport(opts: {
  nodeId: string
  resId: string
  token: string
  actor: string
  initialLastSeq?: number
  handlers: RoomSocketHandlers
}): RoomTransport {
  if (USE_MOCK) return new MockRoomTransport(opts.nodeId, opts.resId, opts.actor, opts.handlers)
  return new RoomSocket({
    wsPath: `/stronghold/${opts.nodeId}/rooms/${opts.resId}/ws`,
    mint: () => api.mintRoomToken(opts.token, opts.nodeId, opts.resId),
    initialLastSeq: opts.initialLastSeq,
    handlers: opts.handlers,
  })
}
