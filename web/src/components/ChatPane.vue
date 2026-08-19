<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { EMPTY_STATE } from '../assets/mew'
import { useAuth } from '../composables/useAuth'
import { useChatRoom } from '../composables/useChatRoom'
import { useImageAttachments } from '../composables/useImageAttachments'
import { useStrongholdConfig } from '../composables/useStrongholdConfig'
import { useStrongholdMembers } from '../composables/useStrongholdMembers'
import { actorLocalpart } from '../utils/actor'
import { WinButton, WinInfoBar } from '../vendor/winui'
import EmotePicker from './EmotePicker.vue'
import EmptyState from './EmptyState.vue'
import MessageBubble, { type MessageVM } from './MessageBubble.vue'

const auth = useAuth()
const { config } = useStrongholdConfig()
const { members } = useStrongholdMembers()
const { items, pending, historyLoading, hasMoreHistory, loadOlder, sendText, resend, editMessage, retractMessage } = useChatRoom()
const attachments = useImageAttachments()

const draft = ref('')
const editingSeq = ref<number | null>(null)
const editingText = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const showEmotePicker = ref(false)
const imageInput = ref<HTMLInputElement | null>(null)

function displayName(actor: string): string {
  return members.value.find((m) => m.actor === actor)?.display_name ?? actorLocalpart(actor)
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function canEdit(actor: string, ts: number): boolean {
  if (actor !== auth.user.value?.actor || !config.value?.allow_message_edit) return false
  const windowSecs = config.value.edit_window_secs
  return windowSecs <= 0 || (Date.now() - ts) / 1000 <= windowSecs
}

function canRetract(actor: string, ts: number): boolean {
  if (actor !== auth.user.value?.actor || !config.value?.allow_message_retract) return false
  const windowSecs = config.value.edit_window_secs
  return windowSecs <= 0 || (Date.now() - ts) / 1000 <= windowSecs
}

const messages = computed<MessageVM[]>(() => {
  const confirmed: MessageVM[] = items.value.map((item) => ({
    key: `s${item.seq}`,
    seq: item.seq,
    actor: item.actor,
    displayName: displayName(item.actor),
    content: item.body.text ?? '',
    media: item.body.media,
    timestamp: formatTime(item.ts),
    editedAt: item.edited_at,
    mine: item.actor === auth.user.value?.actor,
    editable: canEdit(item.actor, item.ts),
    retractable: canRetract(item.actor, item.ts),
    pending: false,
    failed: false,
  }))
  const optimistic: MessageVM[] = pending.value.map((p) => ({
    key: `p${p.clientId}`,
    seq: null,
    actor: auth.user.value?.actor ?? '',
    displayName: displayName(auth.user.value?.actor ?? ''),
    content: p.text,
    media: p.media,
    timestamp: formatTime(p.ts),
    mine: true,
    editable: false,
    retractable: false,
    pending: p.status === 'sending',
    failed: p.status === 'failed',
  }))
  return [...confirmed, ...optimistic]
})

const groupedMessages = computed(() =>
  messages.value.map((message, index) => {
    const previous = messages.value[index - 1]
    const grouped = previous !== undefined && previous.actor === message.actor && previous.mine === message.mine
    return { message, grouped }
  }),
)

function submit() {
  if (!draft.value.trim() && !attachments.items.value.length) return
  const text = draft.value
  const media = attachments.items.value.length ? [...attachments.items.value] : undefined
  draft.value = ''
  attachments.reset()
  sendText(text, media)
}

function pickEmote(code: string) {
  showEmotePicker.value = false
  sendText(code)
}

function onEnter(event: KeyboardEvent) {
  if (event.shiftKey) return
  event.preventDefault()
  submit()
}

function pickImages() {
  imageInput.value?.click()
}

function onImageInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) void attachments.addFiles(input.files)
  input.value = ''
}

function onPaste(event: ClipboardEvent) {
  const files = [...(event.clipboardData?.items ?? [])]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file != null)
  if (files.length) {
    event.preventDefault()
    void attachments.addFiles(files)
  }
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/'))
  if (files.length) void attachments.addFiles(files)
}

function startEdit(message: MessageVM) {
  if (message.seq == null) return
  editingSeq.value = message.seq
  editingText.value = message.content
}

function cancelEdit() {
  editingSeq.value = null
  editingText.value = ''
}

async function submitEdit() {
  if (editingSeq.value == null) return
  const ok = await editMessage(editingSeq.value, editingText.value)
  if (ok) cancelEdit()
}

async function onRetract(message: MessageVM) {
  if (message.seq == null) return
  if (!confirm('撤回这条消息？')) return
  await retractMessage(message.seq)
}

function onResend(message: MessageVM) {
  const clientId = message.key.startsWith('p') ? message.key.slice(1) : ''
  if (clientId) resend(clientId)
}

watch(
  () => messages.value.length,
  async () => {
    await nextTick()
    if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight
  },
)
</script>

<template>
  <section class="chat-pane">
    <div ref="scrollEl" class="chat-pane__messages">
      <div v-if="hasMoreHistory" class="chat-pane__load-more">
        <WinButton Style="SubtleButtonStyle" :IsEnabled="!historyLoading" @Click="loadOlder">
          {{ historyLoading ? '加载中…' : '加载更早的消息' }}
        </WinButton>
      </div>
      <EmptyState v-if="!groupedMessages.length && !historyLoading" :image="EMPTY_STATE.chat" text="还没有消息，说点什么吧" />
      <MessageBubble
        v-for="entry in groupedMessages"
        :key="entry.message.key"
        :message="entry.message"
        :grouped="entry.grouped"
        :editing="editingSeq === entry.message.seq"
        v-model:editing-text="editingText"
        @edit="startEdit(entry.message)"
        @cancel-edit="cancelEdit"
        @submit-edit="submitEdit"
        @retract="onRetract(entry.message)"
        @resend="onResend(entry.message)"
      />
    </div>
    <div class="chat-pane__compose-wrap" @dragover.prevent @drop="onDrop">
      <WinInfoBar
        v-if="attachments.error.value"
        :IsOpen="true"
        :IsClosable="false"
        :IsIconVisible="false"
        Severity="Error"
        class="chat-pane__attach-error"
      >
        {{ attachments.error.value }}
      </WinInfoBar>
      <div v-if="attachments.items.value.length" class="chat-pane__attachments">
        <div v-for="item in attachments.items.value" :key="item.id" class="chat-pane__attachment">
          <img :src="item.url" alt="" />
          <button type="button" class="chat-pane__attachment-remove" title="移除" @click="attachments.remove(item.id)">×</button>
        </div>
      </div>
      <div class="chat-pane__compose">
        <EmotePicker v-if="showEmotePicker" @pick="pickEmote" @close="showEmotePicker = false" />
        <WinButton Style="SubtleButtonStyle" class="chat-pane__emote-btn" title="表情" @Click="showEmotePicker = !showEmotePicker">
          😀
        </WinButton>
        <input ref="imageInput" class="chat-pane__image-input" type="file" accept="image/*" multiple @change="onImageInputChange" />
        <WinButton
          Style="SubtleButtonStyle"
          class="chat-pane__image-btn"
          title="发送图片"
          :IsEnabled="!attachments.uploading.value"
          @Click="pickImages"
        >
          🖼
        </WinButton>
        <textarea
          v-model="draft"
          class="chat-pane__input"
          rows="1"
          placeholder="说点什么…"
          @keydown.enter="onEnter"
          @paste="onPaste"
        ></textarea>
        <WinButton Style="AccentButtonStyle" class="chat-pane__send" @Click="submit">发送</WinButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
.chat-pane {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chat-pane__messages {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  /* vertical rhythm between rows now lives in MessageBubble's own margin
     (grouped vs. ungrouped), so no uniform gap here */
}

.chat-pane__load-more {
  display: flex;
  justify-content: center;
  margin-bottom: 0.75rem;
}

.chat-pane__compose-wrap {
  flex: 0 0 auto;
  background: var(--layer-default);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border-top: 1px solid var(--stroke-divider);
}

.chat-pane__attach-error {
  margin: 0.6rem 1rem 0;
}

.chat-pane__attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0.6rem 1rem 0;
}

.chat-pane__attachment {
  position: relative;
  width: 56px;
  height: 56px;
  border-radius: var(--radius-xs);
  overflow: hidden;
  border: 1px solid var(--card-stroke);
}

.chat-pane__attachment img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.chat-pane__attachment-remove {
  position: absolute;
  top: 0;
  right: 0;
  width: 18px;
  height: 18px;
  line-height: 16px;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 0.85rem;
}

.chat-pane__compose {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
}

.chat-pane__emote-btn,
.chat-pane__image-btn {
  min-height: 40px;
  padding: 0 0.7rem;
  border-radius: var(--radius-md);
  font-size: 1.1rem;
}

.chat-pane__image-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.chat-pane__input {
  flex: 1 1 auto;
  min-height: 40px;
  max-height: 140px;
  padding: 0.5rem 0.85rem;
  border-radius: var(--radius-md);
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border);
  border-bottom: 2px solid transparent;
  color: var(--text-primary);
  font: inherit;
  line-height: 1.4;
  resize: none;
  transition:
    border-color var(--fast-duration) var(--fast-out-slow-in),
    background var(--fast-duration) var(--fast-out-slow-in);
}

.chat-pane__input::placeholder {
  color: var(--text-tertiary);
}

.chat-pane__input:hover {
  background: var(--ctrl-fill-secondary);
}

.chat-pane__input:focus {
  outline: none;
  background: var(--ctrl-fill-default);
  border-bottom-color: rgb(var(--colors-primary));
}

.chat-pane__send {
  min-height: 40px;
  padding: 0 1.1rem;
  border-radius: var(--radius-md);
}
</style>
