import { ref, watch } from 'vue'
import { api } from '../api'
import type { StrongholdConfig } from '../api/types'
import { useAuth } from './useAuth'
import { useStronghold } from './useStronghold'

const config = ref<StrongholdConfig | null>(null)
let loadedForNode = ''

async function loadConfig(nodeId: string) {
  const auth = useAuth()
  if (!nodeId) return
  try {
    config.value = await api.getStrongholdConfig(auth.token.value, nodeId)
    loadedForNode = nodeId
  } catch {
    config.value = null
  }
}

// read-only cache of the current stronghold's config - separate from
// StrongholdAdminModal's own settings-form load, which needs an editable draft.
// feeds the stronghold home card and the edit/retract affordances on items.
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
  // switching strongholds is the only thing that invalidates the cache above,
  // so an in-place settings save has to say so explicitly
  function reload(): Promise<void> {
    return loadConfig(selectedNodeId.value)
  }
  return { config, reload }
}
