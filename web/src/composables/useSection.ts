import { computed, effectScope, ref, watch } from 'vue'
import type { RoomSummary } from '../api/types'
import { useStronghold } from './useStronghold'

const selectedResId = ref('')

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
  const scope = effectScope(true)
  scope.run(() => {
    watch(
      sectionRooms,
      (rooms) => {
        if (!rooms.some((r) => r.id === selectedResId.value)) selectedResId.value = rooms[0]?.id ?? ''
      },
      { immediate: true },
    )

  })
}

export function useSection() {
  installWatchers()

  function selectSection(room: RoomSummary) {
    selectedResId.value = room.id
  }

  return { sectionRooms, selectedSection, selectSection }
}
