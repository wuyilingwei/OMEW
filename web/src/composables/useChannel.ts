import { computed, ref, watch } from 'vue'
import type { RoomSummary } from '../api/types'
import { useStronghold } from './useStronghold'

const selectedResId = ref('')

export function useChannel() {
  const { currentNode } = useStronghold()

  const channelRooms = computed<RoomSummary[]>(() => currentNode.value?.rooms.filter((r) => r.type === 'channel') ?? [])

  watch(
    channelRooms,
    (rooms) => {
      if (!rooms.some((r) => r.id === selectedResId.value)) selectedResId.value = rooms[0]?.id ?? ''
    },
    { immediate: true },
  )

  const selectedChannel = computed<RoomSummary | null>(
    () => channelRooms.value.find((r) => r.id === selectedResId.value) ?? channelRooms.value[0] ?? null,
  )

  function selectChannel(room: RoomSummary) {
    selectedResId.value = room.id
  }

  return { channelRooms, selectedChannel, selectChannel }
}
