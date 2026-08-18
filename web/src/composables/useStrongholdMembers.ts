import { computed, ref, watch } from 'vue'
import { api } from '../api'
import type { MemberTab, StrongholdMember } from '../api/types'
import { useAuth } from './useAuth'
import { useStronghold } from './useStronghold'

const members = ref<StrongholdMember[]>([])
const loading = ref(false)
const loadError = ref('')
let loadedForNode = ''

async function loadMembers(nodeId: string, tab: MemberTab = 'all') {
  const auth = useAuth()
  if (!auth.token.value) return
  loading.value = true
  loadError.value = ''
  try {
    const page = await api.getStrongholdMembers(auth.token.value, nodeId, tab)
    members.value = page.members
    loadedForNode = nodeId
  } catch {
    loadError.value = '无法加载成员列表'
  } finally {
    loading.value = false
  }
}

export function useStrongholdMembers() {
  const auth = useAuth()
  const { selectedNodeId } = useStronghold()

  // keep the "all" roster fresh whenever the active stronghold changes, so
  // myRole below stays correct without every caller having to trigger a load
  watch(
    selectedNodeId,
    (nodeId) => {
      if (nodeId && nodeId !== loadedForNode) loadMembers(nodeId, 'all')
    },
    { immediate: true },
  )

  const myRole = computed(() => {
    const username = auth.user.value?.username
    if (!username) return null
    return members.value.find((member) => member.username === username)?.role ?? null
  })

  return { members, loading, loadError, myRole, loadMembers }
}
