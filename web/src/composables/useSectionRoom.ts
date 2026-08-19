import { computed, ref, watch } from 'vue'
import { api } from '../api'
import { createRoomTransport } from '../api/transport'
import type { MediaAttachment, PostReply, PostSummary, PostThread, RoomSummary } from '../api/types'
import type { RoomTransport } from '../api/roomSocket'
import { useAuth } from './useAuth'
import { useStronghold } from './useStronghold'

const POSTS_PAGE_SIZE = 20
const REPLIES_PAGE_SIZE = 30

const posts = ref<PostSummary[]>([])
const postsLoading = ref(false)
const postsCursor = ref<string | null>(null)
const hasMorePosts = ref(true)
const connected = ref(false)

const thread = ref<PostThread | null>(null)
const threadLoading = ref(false)
const threadRepliesLoading = ref(false)
const threadHasMore = ref(false)
let openPostSeq: number | null = null

let transport: RoomTransport | null = null
let roomKey = ''

// item.create's broadcast excludes the sender (room-do.ts enqueueBroadcast
// passes the sender's own ws to exclude it from the batch fan-out) - the
// author only learns their own post/reply landed via the ack. Track what
// each in-flight client_id was creating so the ack handler can splice it
// into local state instead of waiting for a broadcast that will never come.
interface PendingCreate {
  kind: 'post' | 'reply'
  actor: string
  title?: string
  text: string
  cover?: string
  media?: MediaAttachment[]
  parentSeq?: number
}
const pendingCreates = new Map<string, PendingCreate>()

function bumpPost(update: { post_seq: number; last_reply_seq: number; reply_count: number; preview: string; ts: number }) {
  const idx = posts.value.findIndex((p) => p.post_seq === update.post_seq)
  if (idx >= 0) {
    const next = { ...posts.value[idx]!, last_reply_seq: update.last_reply_seq, reply_count: update.reply_count, bumped_at: update.ts }
    posts.value.splice(idx, 1)
    posts.value.unshift(next)
  }
  if (thread.value && thread.value.post.post_seq === update.post_seq) {
    thread.value = { ...thread.value, post: { ...thread.value.post, reply_count: update.reply_count, bumped_at: update.ts } }
  }
}

async function connectRoom(nodeId: string, room: RoomSummary) {
  const key = `${nodeId}/${room.id}`
  if (key === roomKey) return
  roomKey = key
  transport?.close()
  transport = null
  posts.value = []
  postsCursor.value = null
  hasMorePosts.value = true
  connected.value = false
  thread.value = null
  openPostSeq = null
  pendingCreates.clear()

  const auth = useAuth()
  if (!auth.token.value) return

  await loadMorePosts(true)
  if (roomKey !== key) return

  transport = createRoomTransport({
    nodeId,
    resId: room.id,
    token: auth.token.value,
    actor: auth.user.value?.actor ?? '',
    handlers: {
      onOpen: () => {
        connected.value = true
      },
      onClose: () => {
        connected.value = false
      },
      onAck: (ack) => {
        if (!ack.client_id || typeof ack.seq !== 'number') return
        const pending = pendingCreates.get(ack.client_id)
        if (!pending) return
        pendingCreates.delete(ack.client_id)
        const ts = Date.now()
        if (pending.kind === 'post') {
          const entry: PostSummary = {
            post_seq: ack.seq,
            actor: pending.actor,
            created_at: ts,
            title: pending.title ?? '',
            cover: pending.cover ?? null,
            preview: pending.text.slice(0, 80),
            media: pending.media,
            last_reply_seq: ack.seq,
            reply_count: 0,
            bumped_at: ts,
          }
          if (!posts.value.some((p) => p.post_seq === ack.seq)) posts.value.unshift(entry)
          // the just-created post's own detail view (if open) won't otherwise
          // pick up media - the real listPosts/getPost projection doesn't
          // carry it yet (server-side gap tracked separately) - patch the
          // locally-known thread in place so the author's own view is correct.
          if (thread.value && thread.value.post.post_seq === ack.seq && pending.media?.length) {
            thread.value = { ...thread.value, post: { ...thread.value.post, media: pending.media } }
          }
        } else if (thread.value && thread.value.post.post_seq === pending.parentSeq) {
          const reply: PostReply = { seq: ack.seq, actor: pending.actor, ts, body: { text: pending.text, media: pending.media } }
          if (!thread.value.replies.some((r) => r.seq === reply.seq)) {
            thread.value = { ...thread.value, replies: [reply, ...thread.value.replies] }
          }
        }
      },
      onBump: (b) => bumpPost(b),
      onItem: (item) => {
        // a reply created elsewhere while a thread is open - append live.
        if (item.parent_seq != null && thread.value && item.root_seq === thread.value.post.post_seq) {
          const reply: PostReply = { seq: item.seq, actor: item.actor, ts: item.ts, body: item.body }
          if (!thread.value.replies.some((r) => r.seq === reply.seq)) {
            thread.value = { ...thread.value, replies: [reply, ...thread.value.replies] }
          }
        }
      },
      onUpdate: () => {},
      onDelete: (d) => {
        if (thread.value) thread.value = { ...thread.value, replies: thread.value.replies.filter((r) => r.seq !== d.target_seq) }
      },
    },
  })
  transport.connect()
}

async function loadMorePosts(reset = false) {
  const { selectedNodeId, currentNode } = useStronghold()
  const auth = useAuth()
  const room = currentNode.value?.rooms.find((r) => r.type === 'section')
  if (!auth.token.value || !selectedNodeId.value || !room) return
  if (!reset && (postsLoading.value || !hasMorePosts.value)) return
  postsLoading.value = true
  try {
    const page = await api.listPosts(auth.token.value, selectedNodeId.value, room.id, reset ? null : postsCursor.value, POSTS_PAGE_SIZE)
    posts.value = reset ? page.posts : [...posts.value, ...page.posts]
    postsCursor.value = page.next_cursor
    hasMorePosts.value = page.next_cursor != null
  } catch {
    // keep whatever we already had
  } finally {
    postsLoading.value = false
  }
}

export function useSectionRoom() {
  const { selectedNodeId, currentNode } = useStronghold()
  const postRoom = computed<RoomSummary | null>(() => currentNode.value?.rooms.find((r) => r.type === 'section') ?? null)

  watch(
    [selectedNodeId, postRoom],
    ([nodeId, room]) => {
      if (nodeId && room) void connectRoom(nodeId, room)
      else {
        transport?.close()
        transport = null
        roomKey = ''
        posts.value = []
        thread.value = null
      }
    },
    { immediate: true },
  )

  function createPost(title: string, text: string, cover?: string, media?: MediaAttachment[]) {
    const auth = useAuth()
    if (!transport || !auth.user.value) return false
    const clientId = crypto.randomUUID()
    const trimmedTitle = title.trim()
    const trimmedText = text.trim()
    const trimmedCover = cover?.trim() || undefined
    const body: Record<string, unknown> = { title: trimmedTitle, text: trimmedText }
    if (trimmedCover) body.cover = trimmedCover
    if (media?.length) body.media = media
    const ok = transport.createItem(clientId, 'post', body)
    if (ok) {
      pendingCreates.set(clientId, {
        kind: 'post',
        actor: auth.user.value.actor,
        title: trimmedTitle,
        text: trimmedText,
        cover: trimmedCover,
        media,
      })
    }
    return ok
  }

  async function openThread(postSeq: number) {
    const auth = useAuth()
    const nodeId = selectedNodeId.value
    const room = postRoom.value
    openPostSeq = postSeq
    if (!auth.token.value || !nodeId || !room) return
    threadLoading.value = true
    thread.value = null
    try {
      const result = await api.getPost(auth.token.value, nodeId, room.id, postSeq, null, REPLIES_PAGE_SIZE)
      if (openPostSeq !== postSeq) return // superseded
      thread.value = result
      threadHasMore.value = result.next_before != null
    } finally {
      threadLoading.value = false
    }
  }

  function closeThread() {
    openPostSeq = null
    thread.value = null
  }

  async function loadMoreReplies() {
    const auth = useAuth()
    const nodeId = selectedNodeId.value
    const room = postRoom.value
    if (!auth.token.value || !nodeId || !room || !thread.value || threadRepliesLoading.value || !threadHasMore.value) return
    const before = thread.value.next_before
    if (before == null) return
    threadRepliesLoading.value = true
    try {
      const result = await api.getPost(auth.token.value, nodeId, room.id, thread.value.post.post_seq, before, REPLIES_PAGE_SIZE)
      thread.value = { post: thread.value.post, replies: [...thread.value.replies, ...result.replies], next_before: result.next_before }
      threadHasMore.value = result.next_before != null
    } finally {
      threadRepliesLoading.value = false
    }
  }

  function createReply(text: string, media?: MediaAttachment[]) {
    const auth = useAuth()
    if (!transport || !thread.value || !auth.user.value) return false
    const clientId = crypto.randomUUID()
    const trimmedText = text.trim()
    const postSeq = thread.value.post.post_seq
    const body: Record<string, unknown> = { text: trimmedText }
    if (media?.length) body.media = media
    const ok = transport.createItem(clientId, 'reply', body, postSeq)
    if (ok) {
      pendingCreates.set(clientId, { kind: 'reply', actor: auth.user.value.actor, text: trimmedText, media, parentSeq: postSeq })
    }
    return ok
  }

  return {
    postRoom,
    posts,
    postsLoading,
    hasMorePosts,
    connected,
    loadMorePosts: () => loadMorePosts(false),
    createPost,
    thread,
    threadLoading,
    threadRepliesLoading,
    threadHasMore,
    openThread,
    closeThread,
    loadMoreReplies,
    createReply,
  }
}
