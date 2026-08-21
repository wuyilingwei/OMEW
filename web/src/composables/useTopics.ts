import { computed, effectScope, ref, watch } from 'vue'
import { api } from '../api'
import type { Topic } from '../api/types'
import { useAuth } from './useAuth'
import { useStronghold } from './useStronghold'

const topics = ref<Topic[]>([])
const topicsLoading = ref(false)
let loadedForNodeId = ''
// single-flight per nodeId - a request for a different node chains after the
// in-flight one instead of being dropped, so rapid stronghold switching still
// ends up loading the last-selected node's topics.
let inflight: Promise<void> | null = null
let inflightNodeId = ''

function loadTopics(nodeId: string, force = false): Promise<void> {
  if (!nodeId) {
    topics.value = []
    loadedForNodeId = ''
    return Promise.resolve()
  }
  if (loadedForNodeId === nodeId && !force) return Promise.resolve()
  if (inflight) {
    if (inflightNodeId === nodeId) return inflight
    return inflight.then(() => loadTopics(nodeId, force))
  }
  topicsLoading.value = true
  inflightNodeId = nodeId
  const auth = useAuth()
  inflight = (async () => {
    try {
      topics.value = await api.listTopics(auth.token.value ?? null, nodeId)
      loadedForNodeId = nodeId
    } catch {
      topics.value = []
    } finally {
      topicsLoading.value = false
      inflight = null
      inflightNodeId = ''
    }
  })()
  return inflight
}

let watchersInstalled = false
function installWatchers() {
  if (watchersInstalled) return
  watchersInstalled = true
  const { selectedNodeId } = useStronghold()

  const scope = effectScope(true)
  scope.run(() => {
    watch(
      selectedNodeId,
      (nodeId) => {
        void loadTopics(nodeId)
      },
      { immediate: true },
    )
  })
}

export function useTopics() {
  installWatchers()
  const { selectedNodeId } = useStronghold()
  const topicById = computed(() => (id: string) => topics.value.find((t) => t.id === id))
  return {
    topics,
    topicsLoading,
    reloadTopics: () => loadTopics(selectedNodeId.value, true),
    topicById,
  }
}
