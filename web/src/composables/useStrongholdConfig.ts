import { effectScope, ref, watch } from 'vue'
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
    const loaded = await api.getStrongholdConfig(auth.token.value, nodeId)
    // a fast stronghold switch (or a deep link resolving after the default
    // selection) leaves two loads in flight - drop whichever no longer matches
    // the current selection instead of letting the slower one win.
    const { selectedNodeId } = useStronghold()
    if (selectedNodeId.value !== nodeId) return
    config.value = loaded
    loadedForNode = nodeId
  } catch {
    const { selectedNodeId } = useStronghold()
    if (selectedNodeId.value === nodeId) config.value = null
  }
}

// module-level singleton watcher behind a guard: several components call this,
// and a per-call watch would both leak and multiply the concurrent loads above.
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
        if (nodeId && nodeId !== loadedForNode) void loadConfig(nodeId)
        else if (!nodeId) config.value = null
      },
      { immediate: true },
    )
  })
}

// read-only cache of the current stronghold's config - separate from
// StrongholdAdminModal's own settings-form load, which needs an editable draft.
// feeds the stronghold home card and the edit/retract affordances on items.
export function useStrongholdConfig() {
  installWatchers()
  const { selectedNodeId } = useStronghold()
  // switching strongholds is the only thing that invalidates the cache above,
  // so an in-place settings save has to say so explicitly
  function reload(): Promise<void> {
    loadedForNode = ''
    return loadConfig(selectedNodeId.value)
  }
  return { config, reload }
}
