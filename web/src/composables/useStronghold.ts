import { computed, ref, watch } from 'vue'
import { api } from '../api'
import type { StrongholdSummary } from '../api/types'
import { useAuth } from './useAuth'

const nodes = ref<StrongholdSummary[]>([])
const selectedNodeId = ref('')
const loading = ref(false)
const loadError = ref('')
let loaded = false

async function loadStrongholds(force = false) {
  const auth = useAuth()
  if (!auth.token.value) return
  if (loaded && !force) return
  loading.value = true
  loadError.value = ''
  try {
    nodes.value = await api.listMyStrongholds(auth.token.value)
    if (!nodes.value.some((n) => n.id === selectedNodeId.value)) {
      selectedNodeId.value = nodes.value[0]?.id ?? ''
    }
    loaded = true
  } catch {
    loadError.value = '无法加载据点列表'
  } finally {
    loading.value = false
  }
}

function selectNode(id: string) {
  selectedNodeId.value = id
}

export function useStronghold() {
  const auth = useAuth()
  watch(
    auth.isAuthenticated,
    (authenticated) => {
      if (authenticated) loadStrongholds()
      else {
        nodes.value = []
        selectedNodeId.value = ''
        loaded = false
      }
    },
    { immediate: true },
  )

  const currentNode = computed<StrongholdSummary | null>(() => nodes.value.find((n) => n.id === selectedNodeId.value) ?? null)

  return { nodes, selectedNodeId, currentNode, loading, loadError, selectNode, loadStrongholds }
}
