import { computed, ref, watch } from 'vue'
import type { RoomSummary } from '../api/types'
import { useStronghold } from './useStronghold'

const selectedResId = ref('')
const topicFilter = ref<string | null>(null)

export function useSection() {
  const { currentNode, selectedNodeId } = useStronghold()

  const sectionRooms = computed<RoomSummary[]>(() => currentNode.value?.rooms.filter((r) => r.type === 'section') ?? [])

  watch(
    sectionRooms,
    (rooms) => {
      if (!rooms.some((r) => r.id === selectedResId.value)) selectedResId.value = rooms[0]?.id ?? ''
    },
    { immediate: true },
  )

  // 据点切换时话题筛选重置为全部
  watch(selectedNodeId, () => {
    topicFilter.value = null
  })

  const selectedSection = computed<RoomSummary | null>(
    () => sectionRooms.value.find((r) => r.id === selectedResId.value) ?? sectionRooms.value[0] ?? null,
  )

  function selectSection(room: RoomSummary) {
    selectedResId.value = room.id
    topicFilter.value = null
  }

  function setTopicFilter(id: string | null) {
    topicFilter.value = id
  }

  return { sectionRooms, selectedSection, selectSection, topicFilter, setTopicFilter }
}
