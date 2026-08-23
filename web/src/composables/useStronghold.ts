import { computed, effectScope, ref, watch } from 'vue'
import { api } from '../api'
import type { DirectoryEntry, StrongholdSummary } from '../api/types'
import { useAuth } from './useAuth'
import { useInstanceConfig } from './useInstanceConfig'

const nodes = ref<StrongholdSummary[]>([])
const publicDirectory = ref<DirectoryEntry[]>([])
const selectedNodeId = ref('')
const loading = ref(false)
const loadError = ref('')
const authState = useAuth()
// Public browsing covers both anonymous visitors and authenticated users who
// have not joined any stronghold yet. The latter keep their session so they can
// join directly, but remain read-only until membership is established.
const isGuestMode = ref(false)
const isPublicPreview = ref(false)
const isDirectoryBrowsing = computed(() => isGuestMode.value || isPublicPreview.value)
const isReadOnly = computed(() => isGuestMode.value || (isPublicPreview.value && !authState.isAdmin.value))
const joinedNodeIds = ref<Set<string>>(new Set())
let loaded = false
let loadedPublic = false
const publicRoomsFetched = new Set<string>()
// single-flight: useStronghold() has many callers whose watchers can all fire
// before the first fetch resolves - without this every mounted caller issues
// its own identical request.
let inflight: Promise<void> | null = null

async function replaceWithPublicDirectory() {
  const entries = await api.getDirectory()
  publicDirectory.value = entries
  publicRoomsFetched.clear()
  nodes.value = entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    avatar: entry.avatar,
    cover: entry.cover,
    slug: entry.slug,
    rooms: [],
  }))
  if (!nodes.value.some((node) => node.id === selectedNodeId.value)) {
    selectedNodeId.value = nodes.value[0]?.id ?? ''
  }
  if (selectedNodeId.value) void ensurePublicRooms(selectedNodeId.value)
  loadedPublic = true
}

function loadStrongholds(
  force = false,
  allowPublicPreview = useInstanceConfig().config.value?.allow_guest_browsing ?? false,
): Promise<void> {
  const auth = useAuth()
  if (!auth.token.value) return Promise.resolve()
  if (loaded && !force) return Promise.resolve()
  if (inflight) return inflight.then(() => loadStrongholds(force, allowPublicPreview))
  loading.value = true
  loadError.value = ''
  inflight = (async () => {
    try {
      const memberNodes = await api.listMyStrongholds(auth.token.value!)
      joinedNodeIds.value = new Set(memberNodes.map((node) => node.id))
      if (memberNodes.length === 0 && allowPublicPreview) {
        await replaceWithPublicDirectory()
        isPublicPreview.value = true
      } else {
        nodes.value = memberNodes
        loadedPublic = false
        isPublicPreview.value = false
      }
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

function loadPublicDirectory(force = false): Promise<void> {
  if (loadedPublic && !force) return Promise.resolve()
  if (inflight) return inflight.then(() => loadPublicDirectory(force))
  loading.value = true
  loadError.value = ''
  inflight = (async () => {
    try {
      if (authState.isAuthenticated.value) {
        publicDirectory.value = await api.getDirectory()
        loadedPublic = true
      } else {
        await replaceWithPublicDirectory()
      }
    } catch {
      loadError.value = '无法加载据点目录'
    } finally {
      loading.value = false
      inflight = null
    }
  })()
  return inflight
}

async function ensurePublicRooms(nodeId: string) {
  if (!nodeId || publicRoomsFetched.has(nodeId)) return
  publicRoomsFetched.add(nodeId)
  try {
    const auth = useAuth()
    const rooms = await api.getStrongholdRooms(isGuestMode.value ? null : auth.token.value, nodeId)
    const idx = nodes.value.findIndex((n) => n.id === nodeId)
    if (idx >= 0) nodes.value.splice(idx, 1, { ...nodes.value[idx]!, rooms })
  } catch {
    publicRoomsFetched.delete(nodeId)
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
          isPublicPreview.value = joinedNodeIds.value.size === 0
          const needsPublicFallback = guestAllowed && nodes.value.length === 0
          void loadStrongholds(needsPublicFallback, guestAllowed)
        } else if (guestAllowed) {
          loaded = false
          joinedNodeIds.value = new Set()
          isPublicPreview.value = false
          publicDirectory.value = []
          isGuestMode.value = true
          void loadPublicDirectory()
        } else {
          loaded = false
          loadedPublic = false
          joinedNodeIds.value = new Set()
          isPublicPreview.value = false
          isGuestMode.value = false
          nodes.value = []
          publicDirectory.value = []
          selectedNodeId.value = ''
        }
      },
      { immediate: true },
    )

    watch(
      [selectedNodeId, isDirectoryBrowsing],
      ([nodeId, directoryBrowsing]) => {
        if (nodeId && directoryBrowsing) void ensurePublicRooms(nodeId)
      },
      { immediate: true },
    )
  })
}

export function useStronghold() {
  installWatchers()
  return {
    nodes,
    publicDirectory,
    joinedNodeIds,
    selectedNodeId,
    currentNode,
    loading,
    loadError,
    isGuestMode,
    isPublicPreview,
    isReadOnly,
    selectNode,
    loadStrongholds,
    loadPublicDirectory,
  }
}
