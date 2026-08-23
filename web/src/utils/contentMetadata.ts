import type { RoomSummary } from '../api/types'

export function resolveSectionTarget(rooms: RoomSummary[], targetId: string, fallbackId = ''): RoomSummary | null {
  return rooms.find((room) => room.id === targetId) ?? rooms.find((room) => room.id === fallbackId) ?? rooms[0] ?? null
}

export function channelDescription(description: string | null | undefined): string {
  return description?.trim() ?? ''
}
