import { ref, watch } from 'vue'
import { api } from '../api'
import { createRoomTransport } from '../api/transport'
import type { MediaAttachment, RoomItem, RoomSummary } from '../api/types'
import type { RoomTransport } from '../api/roomSocket'
// mirrors server's types.ts DENY_CHANNEL_SPEAK bit (m0-protocol S3.4 deny bitmask)
const DENY_CHANNEL_SPEAK = 1
import { useAuth } from './useAuth'
import { useChannel } from './useChannel'
import { useStronghold } from './useStronghold'

export interface PendingSend {
  clientId: string
  text: string
  media?: MediaAttachment[]
  ts: number
  status: 'sending' | 'failed'
  // F6: distinguishes a server-side permission denial (OMEW_FORBIDDEN, no
  // point retrying) from an ack timeout/dropped connection (worth a retry) -
  // MessageBubble picks its failure copy and whether to offer 重试 off this.
  failReason?: 'denied' | 'network'
}

const HISTORY_PAGE_SIZE = 50
const ACK_TIMEOUT_MS = 8000
const GUEST_POLL_MS = 15000

const items = ref<RoomItem[]>([])
const pending = ref<PendingSend[]>([])
const connected = ref(false)
const muted = ref(false)
const historyLoading = ref(false)
const hasMoreHistory = ref(true)

let transport: RoomTransport | null = null
let roomKey = ''
let ackTimers = new Map<string, ReturnType<typeof setTimeout>>()
let guestPollTimer: ReturnType<typeof setInterval> | null = null

function upsertItem(item: RoomItem) {
  const idx = items.value.findIndex((i) => i.seq === item.seq)
  if (idx >= 0) items.value.splice(idx, 1, item)
  else {
    items.value.push(item)
    items.value.sort((a, b) => a.seq - b.seq)
  }
}

function clearAckTimer(clientId: string) {
  const t = ackTimers.get(clientId)
  if (t) {
    clearTimeout(t)
    ackTimers.delete(clientId)
  }
}

function stopGuestPolling() {
  if (guestPollTimer) {
    clearInterval(guestPollTimer)
    guestPollTimer = null
  }
}

// guest (no session): merge the latest page back in by seq - picks up both
// new items and edits/retracts that landed on already-known ones, since
// there's no WS to push them. Read-only, so no ack/pending bookkeeping needed.
async function pollLatest(nodeId: string, resId: string, key: string) {
  if (roomKey !== key) return
  try {
    const page = await api.getRoomHistory(null, nodeId, resId, null, HISTORY_PAGE_SIZE)
    if (roomKey !== key) return
    const merged = [...items.value, ...page]
    const dedup = new Map(merged.map((i) => [i.seq, i]))
    items.value = [...dedup.values()].sort((a, b) => a.seq - b.seq)
  } catch {
    // transient network blip - next tick retries
  }
}

function startGuestPolling(nodeId: string, resId: string, key: string) {
  stopGuestPolling()
  guestPollTimer = setInterval(() => void pollLatest(nodeId, resId, key), GUEST_POLL_MS)
}

async function connectRoom(nodeId: string, room: RoomSummary) {
  const key = `${nodeId}/${room.id}`
  if (key === roomKey) return
  roomKey = key
  transport?.close()
  transport = null
  stopGuestPolling()
  items.value = []
  pending.value = []
  hasMoreHistory.value = true
  connected.value = false
  muted.value = false
  for (const t of ackTimers.values()) clearTimeout(t)
  ackTimers = new Map()

  const auth = useAuth()

  await loadHistory(nodeId, room.id, null)
  if (roomKey !== key) return // superseded by another switch while awaiting history

  if (!auth.token.value) {
    // guest: read-only, no room WS - light polling stands in for live updates
    startGuestPolling(nodeId, room.id, key)
    return
  }

  transport = createRoomTransport({
    nodeId,
    resId: room.id,
    token: auth.token.value,
    actor: auth.user.value?.actor ?? '',
    initialLastSeq: items.value[items.value.length - 1]?.seq ?? 0,
    handlers: {
      onOpen: () => {
        connected.value = true
      },
      onClose: () => {
        connected.value = false
      },
      onToken: (claims) => {
        muted.value = (claims.deny & DENY_CHANNEL_SPEAK) !== 0
      },
      onAck: (ack) => {
        if (!ack.client_id) return
        clearAckTimer(ack.client_id)
        // the room broadcast excludes the sender, so the acked message must be
        // upserted locally from the pending entry or it silently vanishes for
        // its own author the moment the optimistic bubble is cleared.
        const sent = pending.value.find((p) => p.clientId === ack.client_id)
        if (sent && typeof ack.seq === 'number') {
          const body: Record<string, unknown> = { text: sent.text }
          if (sent.media?.length) body.media = sent.media
          upsertItem({
            seq: ack.seq,
            parent_seq: null,
            root_seq: null,
            actor: auth.user.value?.actor ?? '',
            kind: 'post',
            ts: sent.ts,
            body,
          } as RoomItem)
        }
        pending.value = pending.value.filter((p) => p.clientId !== ack.client_id)
      },
      onItem: (item) => upsertItem(item),
      onUpdate: (u) => {
        const idx = items.value.findIndex((i) => i.seq === u.target_seq)
        if (idx >= 0) items.value[idx] = { ...items.value[idx]!, body: u.body as RoomItem['body'], edited_at: u.edited_at }
      },
      onDelete: (d) => {
        items.value = items.value.filter((i) => i.seq !== d.target_seq)
      },
      // no client_id on a frame-level error (server's room-do.ts sendError),
      // so this can't target one exact pending entry - marking every
      // still-sending one is the closest match and self-corrects on the next
      // successful send.
      onError: (e) => {
        if (e.code !== 'OMEW_FORBIDDEN') return
        muted.value = true
        for (const entry of pending.value) {
          if (entry.status === 'sending') {
            entry.status = 'failed'
            entry.failReason = 'denied'
            clearAckTimer(entry.clientId)
          }
        }
      },
      onResyncGap: () => {
        void loadHistory(nodeId, room.id, null)
      },
    },
  })
  transport.connect()
}

async function loadHistory(nodeId: string, resId: string, before: number | null) {
  const auth = useAuth()
  historyLoading.value = true
  try {
    const page = await api.getRoomHistory(auth.token.value, nodeId, resId, before, HISTORY_PAGE_SIZE)
    if (page.length < HISTORY_PAGE_SIZE) hasMoreHistory.value = false
    const merged = [...page, ...items.value]
    const dedup = new Map(merged.map((i) => [i.seq, i]))
    items.value = [...dedup.values()].sort((a, b) => a.seq - b.seq)
  } catch {
    // leave whatever we already had - the compose box still works even if
    // history couldn't be fetched (e.g. transient network blip).
  } finally {
    historyLoading.value = false
  }
}

export function useChatRoom() {
  const { selectedNodeId } = useStronghold()
  const { selectedChannel } = useChannel()

  watch(
    [selectedNodeId, selectedChannel],
    ([nodeId, room]) => {
      if (nodeId && room) void connectRoom(nodeId, room)
      else {
        transport?.close()
        transport = null
        stopGuestPolling()
        roomKey = ''
        items.value = []
        pending.value = []
      }
    },
    { immediate: true },
  )

  // awaitable so the caller can restore the reader's scroll position once the
  // prepended page has landed
  async function loadOlder(): Promise<void> {
    const nodeId = selectedNodeId.value
    const room = selectedChannel.value
    const oldest = items.value[0]?.seq
    if (!nodeId || !room || !oldest || historyLoading.value || !hasMoreHistory.value) return
    await loadHistory(nodeId, room.id, oldest)
  }

  function sendText(text: string, media?: MediaAttachment[]) {
    const trimmed = text.trim()
    if ((!trimmed && !media?.length) || !transport) return
    const clientId = crypto.randomUUID()
    pending.value.push({ clientId, text: trimmed, media, ts: Date.now(), status: 'sending' })
    const body: Record<string, unknown> = { text: trimmed }
    if (media?.length) body.media = media
    const ok = transport.createItem(clientId, 'post', body)
    if (!ok) {
      const entry = pending.value.find((p) => p.clientId === clientId)
      if (entry) {
        entry.status = 'failed'
        entry.failReason = 'network'
      }
      return
    }
    ackTimers.set(
      clientId,
      setTimeout(() => {
        const entry = pending.value.find((p) => p.clientId === clientId)
        if (entry) {
          entry.status = 'failed'
          entry.failReason = 'network'
        }
      }, ACK_TIMEOUT_MS),
    )
  }

  function resend(clientId: string) {
    const entry = pending.value.find((p) => p.clientId === clientId)
    if (!entry || !transport) return
    entry.status = 'sending'
    entry.failReason = undefined
    // same client_id: server's (origin, client_id) unique index makes this
    // safe even if the original send actually landed and only the ack was lost.
    const body: Record<string, unknown> = { text: entry.text }
    if (entry.media?.length) body.media = entry.media
    const ok = transport.createItem(clientId, 'post', body)
    if (!ok) {
      entry.status = 'failed'
      entry.failReason = 'network'
      return
    }
    ackTimers.set(
      clientId,
      setTimeout(() => {
        const e = pending.value.find((p) => p.clientId === clientId)
        if (e) {
          e.status = 'failed'
          e.failReason = 'network'
        }
      }, ACK_TIMEOUT_MS),
    )
  }

  async function editMessage(seq: number, text: string): Promise<boolean> {
    const auth = useAuth()
    const nodeId = selectedNodeId.value
    const room = selectedChannel.value
    if (!auth.token.value || !nodeId || !room) return false
    try {
      await api.editItem(auth.token.value, nodeId, room.id, seq, { text: text.trim() })
      return true
    } catch {
      return false
    }
  }

  async function retractMessage(seq: number): Promise<boolean> {
    const auth = useAuth()
    const nodeId = selectedNodeId.value
    const room = selectedChannel.value
    if (!auth.token.value || !nodeId || !room) return false
    try {
      await api.retractItem(auth.token.value, nodeId, room.id, seq)
      items.value = items.value.filter((i) => i.seq !== seq)
      return true
    } catch {
      return false
    }
  }

  return { items, pending, connected, muted, historyLoading, hasMoreHistory, loadOlder, sendText, resend, editMessage, retractMessage }
}
