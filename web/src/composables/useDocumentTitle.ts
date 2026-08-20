import { computed, watchEffect } from 'vue'
import { useStronghold } from './useStronghold'

// keeps the browser tab title in sync with the selected stronghold:
// "OMEW - <据点名>" when one is selected, plain "OMEW" otherwise.
export function useDocumentTitle() {
  const { nodes, selectedNodeId } = useStronghold()
  const currentName = computed(() => nodes.value.find((n) => n.id === selectedNodeId.value)?.name ?? '')
  watchEffect(() => {
    document.title = currentName.value ? `OMEW - ${currentName.value}` : 'OMEW'
  })
}
