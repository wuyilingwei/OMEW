import { ref, watch } from 'vue'
import { api } from '../api'
import { createRoomTransport } from '../api/transport'
import type { MediaAttachment, RoomItem, RoomSummary } from '../api/types'
import type { RoomTransport } from '../api/roomSocket'
import { useAuth } from './useAuth'
import { useChannel } from './useChannel'
import { useStronghold } from './useStronghold'

export interface PendingSend {
  clientId: string
  text: string
  media?: MediaAttachment[]
  ts: number
  status: 'sending' | 'failed'
}

const HISTORY_PAGE_SIZE = 50
const ACK_TIMEOUT_MS = 8000

const items = ref<RoomItem[]>([])
const pending = ref<PendingSend[]>([])
const connected = ref(false)
const historyLoading = ref(false)
const hasMoreHistory = ref(true)

let transport: RoomTransport | null = null
let roomKey = ''
let ackTimers = new Map<string, ReturnType<typeof setTimeout>>()

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

async function connectRoom(nodeId: string, room: RoomSummary) {
  const key = `${nodeId}/${room.id}`
  if (key === roomKey) return
  roomKey = key
  transport?.close()
  transport = null
  items.value = []
  pending.value = []
  hasMoreHistory.value = true
  connected.value = false
  for (const t of ackTimers.values()) clearTimeout(t)
  ackTimers = new Map()

  const auth = useAuth()
  if (!auth.token.value) return

  await loadHistory(nodeId, room.id, null)
  if (roomKey !== key) return // superseded by another switch while awaiting history

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
      onAck: (ack) => {
        if (!ack.client_id) return
        clearAckTimer(ack.client_id)
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
      onResyncGap: () => {
        void loadHistory(nodeId, room.id, null)
      },
    },
  })
  transport.connect()
}

async function loadHistory(nodeId: string, resId: string, before: number | null) {
  const auth = useAuth()
  if (!auth.token.value) return
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
        roomKey = ''
        items.value = []
        pending.value = []
      }
    },
    { immediate: true },
  )

  function loadOlder() {
    const nodeId = selectedNodeId.value
    const room = selectedChannel.value
    const oldest = items.value[0]?.seq
    if (!nodeId || !room || !oldest || historyLoading.value || !hasMoreHistory.value) return
    void loadHistory(nodeId, room.id, oldest)
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
      if (entry) entry.status = 'failed'
      return
    }
    ackTimers.set(
      clientId,
      setTimeout(() => {
        const entry = pending.value.find((p) => p.clientId === clientId)
        if (entry) entry.status = 'failed'
      }, ACK_TIMEOUT_MS),
    )
  }

  function resend(clientId: string) {
    const entry = pending.value.find((p) => p.clientId === clientId)
    if (!entry || !transport) return
    entry.status = 'sending'
    // same client_id: server's (origin, client_id) unique index makes this
    // safe even if the original send actually landed and only the ack was lost.
    const body: Record<string, unknown> = { text: entry.text }
    if (entry.media?.length) body.media = entry.media
    const ok = transport.createItem(clientId, 'post', body)
    if (!ok) {
      entry.status = 'failed'
      return
    }
    ackTimers.set(
      clientId,
      setTimeout(() => {
        const e = pending.value.find((p) => p.clientId === clientId)
        if (e) e.status = 'failed'
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

  return { items, pending, connected, historyLoading, hasMoreHistory, loadOlder, sendText, resend, editMessage, retractMessage }
}
