import { ref, watch } from 'vue'
import { api } from '../api'
import type { StrongholdConfig } from '../api/types'
import { useAuth } from './useAuth'
import { useStronghold } from './useStronghold'

const config = ref<StrongholdConfig | null>(null)
let loadedForNode = ''

async function loadConfig(nodeId: string) {
  const auth = useAuth()
  if (!auth.token.value || !nodeId) return
  try {
    config.value = await api.getStrongholdConfig(auth.token.value, nodeId)
    loadedForNode = nodeId
  } catch {
    config.value = null
  }
}

// read-only cache of the current stronghold's config - separate from
// StrongholdPanel's own settings-form load, which needs an editable draft.
// used to gate the edit/retract affordances on chat messages.
export function useStrongholdConfig() {
  const { selectedNodeId } = useStronghold()
  watch(
    selectedNodeId,
    (nodeId) => {
      if (nodeId && nodeId !== loadedForNode) loadConfig(nodeId)
      else if (!nodeId) config.value = null
    },
    { immediate: true },
  )
  return { config }
}
