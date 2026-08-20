import { computed, effectScope, ref, watch } from 'vue'
import { api } from '../api'
import type { StrongholdSummary } from '../api/types'
import { useAuth } from './useAuth'
import { useInstanceConfig } from './useInstanceConfig'

const nodes = ref<StrongholdSummary[]>([])
const selectedNodeId = ref('')
const loading = ref(false)
const loadError = ref('')
// guest mode (task 034): unauthenticated + instance allows browsing - nodes
// then come from the public directory instead of "my strongholds", and rooms
// load lazily per selection since directory entries don't carry them.
const isGuestMode = ref(false)
let loaded = false
let loadedGuest = false
const guestRoomsFetched = new Set<string>()
// single-flight: useStronghold() has many callers whose watchers can all fire
// before the first fetch resolves - without this every mounted caller issues
// its own identical request.
let inflight: Promise<void> | null = null

function loadStrongholds(force = false): Promise<void> {
  const auth = useAuth()
  if (!auth.token.value) return Promise.resolve()
  if (loaded && !force) return Promise.resolve()
  if (inflight) return inflight
  loading.value = true
  loadError.value = ''
  inflight = (async () => {
    try {
      nodes.value = await api.listMyStrongholds(auth.token.value!)
      if (!nodes.value.some((n) => n.id === selectedNodeId.value)) {
        selectedNodeId.value = nodes.value[0]?.id ?? ''
      }
      loaded = true
    } catch {
      loadError.value = '无法加载据点列表'
    } finally {
      loading.value = false
      inflight = null
    }
  })()
  return inflight
}

function loadGuestDirectory(force = false): Promise<void> {
  if (loadedGuest && !force) return Promise.resolve()
  if (inflight) return inflight
  loading.value = true
  loadError.value = ''
  inflight = (async () => {
    try {
      const entries = await api.getDirectory()
      nodes.value = entries.map((e) => ({ id: e.id, name: e.name, cover: e.cover, rooms: [] }))
      if (!nodes.value.some((n) => n.id === selectedNodeId.value)) {
        selectedNodeId.value = nodes.value[0]?.id ?? ''
      }
      loadedGuest = true
    } catch {
      loadError.value = '无法加载据点目录'
    } finally {
      loading.value = false
      inflight = null
    }
  })()
  return inflight
}

async function ensureGuestRooms(nodeId: string) {
  if (!nodeId || guestRoomsFetched.has(nodeId)) return
  guestRoomsFetched.add(nodeId)
  try {
    const rooms = await api.getStrongholdRooms(null, nodeId)
    const idx = nodes.value.findIndex((n) => n.id === nodeId)
    if (idx >= 0) nodes.value.splice(idx, 1, { ...nodes.value[idx]!, rooms })
  } catch {
    guestRoomsFetched.delete(nodeId)
  }
}

function selectNode(id: string) {
  selectedNodeId.value = id
}

const currentNode = computed<StrongholdSummary | null>(() => nodes.value.find((n) => n.id === selectedNodeId.value) ?? null)

// module-level singleton watchers: registering these per-caller would re-run
// the immediate handler on every component mount. The detached scope keeps
// them alive after the first calling component unmounts.
let watchersInstalled = false
function installWatchers() {
  if (watchersInstalled) return
  watchersInstalled = true
  const auth = useAuth()
  const { config: instanceConfig } = useInstanceConfig()

  const scope = effectScope(true)
  scope.run(() => {
  watch(
    [auth.isAuthenticated, () => instanceConfig.value?.allow_guest_browsing ?? false],
    ([authenticated, guestAllowed]) => {
      if (authenticated) {
        isGuestMode.value = false
        loadedGuest = false
        void loadStrongholds()
      } else if (guestAllowed) {
        loaded = false
        isGuestMode.value = true
        void loadGuestDirectory()
      } else {
        loaded = false
        loadedGuest = false
        isGuestMode.value = false
        nodes.value = []
        selectedNodeId.value = ''
      }
    },
    { immediate: true },
  )

  watch(
    selectedNodeId,
    (nodeId) => {
      if (nodeId && isGuestMode.value) void ensureGuestRooms(nodeId)
    },
    { immediate: true },
  )
  })
}

export function useStronghold() {
  installWatchers()
  return { nodes, selectedNodeId, currentNode, loading, loadError, isGuestMode, selectNode, loadStrongholds }
}
