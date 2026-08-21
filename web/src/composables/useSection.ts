import { computed, effectScope, ref, watch } from 'vue'
import type { RoomSummary } from '../api/types'
import { useStronghold } from './useStronghold'
import { useTopics } from './useTopics'

const selectedResId = ref('')
const topicFilter = ref<string | null>(null)

const sectionRooms = computed<RoomSummary[]>(
  () => useStronghold().currentNode.value?.rooms.filter((r) => r.type === 'section') ?? [],
)

const selectedSection = computed<RoomSummary | null>(
  () => sectionRooms.value.find((r) => r.id === selectedResId.value) ?? sectionRooms.value[0] ?? null,
)

// module-level singleton watchers behind a guard: useSection() is also called
// from useSectionRoom's module-level loaders, where a per-call watch() would
// have no owning scope to dispose it.
let watchersInstalled = false
function installWatchers() {
  if (watchersInstalled) return
  watchersInstalled = true
  const { selectedNodeId } = useStronghold()
  const { topics } = useTopics()

  const scope = effectScope(true)
  scope.run(() => {
    watch(
      sectionRooms,
      (rooms) => {
        if (!rooms.some((r) => r.id === selectedResId.value)) selectedResId.value = rooms[0]?.id ?? ''
      },
      { immediate: true },
    )

    watch(selectedNodeId, () => {
      topicFilter.value = null
    })

    // 正在筛选的话题被删掉后回到全部，否则帖子列表会一直空着
    watch(topics, (list) => {
      if (topicFilter.value && !list.some((t) => t.id === topicFilter.value)) topicFilter.value = null
    })
  })
}

export function useSection() {
  installWatchers()

  function selectSection(room: RoomSummary) {
    selectedResId.value = room.id
    topicFilter.value = null
  }

  function setTopicFilter(id: string | null) {
    topicFilter.value = id
  }

  return { sectionRooms, selectedSection, selectSection, topicFilter, setTopicFilter }
}
