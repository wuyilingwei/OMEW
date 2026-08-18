import { computed, ref } from 'vue'
import { mockNodes } from '../data/mock'

const selectedNodeId = ref(mockNodes.find((node) => node.active)?.id ?? mockNodes[0].id)

function selectNode(id: string) {
  selectedNodeId.value = id
}

export function useStronghold() {
  const currentNode = computed(() => mockNodes.find((node) => node.id === selectedNodeId.value) ?? mockNodes[0])
  return { selectedNodeId, currentNode, selectNode }
}
