import { effectScope, ref, watch } from 'vue'
import { api } from '../api'
import { useChannel } from './useChannel'
import { usePostModal } from './usePostModal'
import { useSection } from './useSection'
import { useSectionRoom } from './useSectionRoom'
import { useShellView } from './useShellView'
import { useStronghold } from './useStronghold'

export interface RouteState {
  server: string
  slug: string
  room: string | null
  kind: 'c' | 's' | null
  postSeq: number | null
}

const route = ref<RouteState | null>(null)

// applyingLocation guards address->state application against re-triggering
// the state->address watchers below - without it every selection made while
// restoring from a URL would immediately push a competing history entry.
let applyingLocation = false
// true only while a post-detail entry that this app pushed is on the stack.
// A deep link straight to /p/<seq> never pushed one, so closing the modal
// there has to rewrite the address instead of walking out of the app.
let postEntryPushed = false
// the address is authoritative until the first restore finishes: the default
// stronghold/room selections that arrive with the initial list would otherwise
// overwrite a deep link before it has been read.
let restored = false

function buildAddress(state: RouteState): string {
  if (!state.server || !state.slug) return '/'
  let path = `/${state.server}/${state.slug}`
  if (state.kind && state.room) {
    path += `/${state.kind}/${state.room}`
    if (state.kind === 's' && state.postSeq != null) path += `/p/${state.postSeq}`
  }
  const params = new URLSearchParams()
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

function parseAddress(): RouteState | null {
  const segments = location.pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null
  const [server, slug, kindSeg, room, pSeg, seqSeg] = segments
  const kind = (kindSeg === 'c' || kindSeg === 's') && room ? kindSeg : null
  const seqNum = kind === 's' && pSeg === 'p' && seqSeg ? Number(seqSeg) : NaN
  return {
    server: server!,
    slug: slug!,
    kind,
    room: kind ? room ?? null : null,
    postSeq: Number.isFinite(seqNum) ? seqNum : null,
  }
}

function writeAddress(state: RouteState, replace: boolean) {
  const address = buildAddress(state)
  const current = location.pathname + location.search
  if (address !== current) {
    if (replace) history.replaceState(null, '', address)
    else history.pushState(null, '', address)
  }
  route.value = state
}

function navigate(next: Partial<RouteState>, opts?: { replace?: boolean }) {
  const base: RouteState = route.value ?? { server: '', slug: '', room: null, kind: null, postSeq: null }
  writeAddress({ ...base, ...next }, opts?.replace ?? false)
}

export function navigateHome() {
  if (location.pathname === '/') return
  history.pushState(null, '', '/')
  window.dispatchEvent(new PopStateEvent('popstate'))
}

let watchersInstalled = false
function installWatchers() {
  if (watchersInstalled) return
  watchersInstalled = true

  const stronghold = useStronghold()
  const channel = useChannel()
  const section = useSection()
  const postModal = usePostModal()
  const shellView = useShellView()

  // On desktop the chat and post columns are visible at once, so the shell's
  // mobile tab can't say which one the address is about - it never leaves its
  // default there. Track the pane the user last acted in instead.
  const pane = ref<'c' | 's'>(shellView.activeView.value === 'posts' ? 's' : 'c')

  function currentKind(): 'c' | 's' | null {
    if (postModal.openPostSeq.value != null) return 's'
    return pane.value
  }

  function reconcileFromLiveState(replace: boolean) {
    if (location.pathname === '/') return
    const node = stronghold.currentNode.value
    const kind = currentKind()
    const room = kind === 'c' ? channel.selectedChannel.value : kind === 's' ? section.selectedSection.value : null
    navigate(
      {
        server: node ? 'a' : '',
        slug: node?.slug ?? '',
        kind: room ? kind : null,
        room: room ? room.id : null,
        postSeq: kind === 's' ? postModal.openPostSeq.value : null,
      },
      { replace },
    )
  }

  // guest mode fetches a stronghold's rooms lazily on selection, so a deep link
  // to a specific room arrives before the room list does. Give it a moment
  // rather than immediately rewriting the address to the default room.
  async function waitForRooms(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      if (stronghold.currentNode.value?.rooms.length) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  // Selecting a stronghold/section triggers an asynchronous post-list reload.
  async function waitForSelectionSettled(): Promise<void> {
    const { postsLoading } = useSectionRoom()
    await new Promise((resolve) => setTimeout(resolve, 0))
    for (let i = 0; i < 40 && postsLoading.value; i++) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  async function applyAddress() {
    applyingLocation = true
    // after a popstate we can no longer tell whether the entry now showing is
    // one we pushed - assume not, so a later close rewrites instead of leaving.
    postEntryPushed = false
    try {
      if (location.pathname === '/') {
        route.value = null
        postModal.close()
        return
      }
      const parsed = parseAddress()
      let nodeId = ''
      if (parsed) {
        try {
          const res = await api.resolveStronghold(parsed.server, parsed.slug)
          nodeId = res.stronghold_id
        } catch {
          nodeId = ''
        }
      }
      if (!nodeId) nodeId = stronghold.nodes.value[0]?.id ?? ''
      if (nodeId) stronghold.selectNode(nodeId)
      if (parsed?.kind && parsed.room) await waitForRooms()

      if (parsed?.kind === 'c') {
        const room = channel.channelRooms.value.find((r) => r.id === parsed.room)
        if (room) channel.selectChannel(room)
        pane.value = 'c'
        shellView.setView('chat')
        postModal.close()
      } else if (parsed?.kind === 's') {
        const room = section.sectionRooms.value.find((r) => r.id === parsed.room)
        if (room) section.selectSection(room)
        pane.value = 's'
        shellView.setView('posts')
        await waitForSelectionSettled()
        if (parsed.postSeq != null) {
          await waitForSelectionSettled()
          postModal.open(parsed.postSeq)
        } else {
          postModal.close()
        }
      } else {
        postModal.close()
      }

      reconcileFromLiveState(true)
    } finally {
      applyingLocation = false
    }
  }

  const scope = effectScope(true)
  scope.run(() => {
    watch(stronghold.selectedNodeId, () => {
      if (restored && !applyingLocation) reconcileFromLiveState(false)
    })

    // each pane's own state claims the address when the user touches it
    watch(channel.selectedChannel, () => {
      if (!restored || applyingLocation) return
      pane.value = 'c'
      reconcileFromLiveState(false)
    })
    watch(section.selectedSection, () => {
      if (!restored || applyingLocation) return
      pane.value = 's'
      reconcileFromLiveState(false)
    })
    // the mobile shell tab is an explicit pane switch when it is in play
    watch(shellView.activeView, (view) => {
      if (!restored || applyingLocation || view === 'stronghold') return
      pane.value = view === 'posts' ? 's' : 'c'
      reconcileFromLiveState(false)
    })

    // post modal open/close: open pushes a new entry, close walks back to the
    // entry that existed before it opened - keeps the back button meaningful.
    watch(postModal.openPostSeq, (seq, prevSeq) => {
      if (!restored || applyingLocation) return
      if (seq != null) {
        reconcileFromLiveState(false)
        postEntryPushed = true
      } else if (prevSeq != null) {
        if (postEntryPushed) {
          postEntryPushed = false
          history.back()
        } else {
          reconcileFromLiveState(true)
        }
      }
    })

    window.addEventListener('popstate', () => {
      void applyAddress()
    })

    // first restore only after the stronghold list has settled - before that
    // a room id in the URL can't be validated against anything.
    let settled = false
    function trySettle() {
      if (settled) return
      settled = true
      void applyAddress().finally(() => {
        restored = true
      })
    }
    watch(stronghold.loading, (isLoading, wasLoading) => {
      if (!isLoading && wasLoading) trySettle()
    })
    watch(
      stronghold.nodes,
      (list) => {
        if (list.length) trySettle()
      },
      { immediate: true },
    )
    // backstop for the case where nothing ever loads (no session and guest
    // browsing off) - the address still needs normalizing. Deliberately not a
    // microtask: firing before the list arrives would resolve the URL against
    // an empty node list and fall back to "no stronghold".
    setTimeout(trySettle, 3000)
  })
}

export function useRoute() {
  installWatchers()
  return { route, navigate }
}
