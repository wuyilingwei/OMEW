<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api, ApiRequestError } from '../api'
import type { DirectMessage } from '../api/types'
import { useAuth } from '../composables/useAuth'
import { WinButton } from '../vendor/winui'

const props = defineProps<{ nodeId: string; targetActor: string; targetName: string }>()

const auth = useAuth()
const messages = ref<DirectMessage[]>([])
const draft = ref('')
const loading = ref(false)
const sending = ref(false)
const error = ref('')

function messageError(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.code === 'DIRECT_MESSAGE_BLOCKED') return '无法发送：你或对方已开启拉黑。'
    if (err.code === 'FORBIDDEN') return '只有当前据点成员可以私聊。'
  }
  return '私聊暂时不可用，请稍后重试。'
}

async function load() {
  const token = auth.token.value
  if (!token) return
  loading.value = true
  error.value = ''
  try {
    messages.value = await api.getDirectMessages(token, props.nodeId, props.targetActor)
  } catch (err) {
    error.value = messageError(err)
  } finally {
    loading.value = false
  }
}

async function send() {
  const token = auth.token.value
  const body = draft.value.trim()
  if (!token || !body || sending.value) return
  sending.value = true
  error.value = ''
  try {
    const message = await api.sendDirectMessage(token, props.nodeId, props.targetActor, body)
    messages.value.push(message)
    draft.value = ''
  } catch (err) {
    error.value = messageError(err)
  } finally {
    sending.value = false
  }
}

watch(() => props.targetActor, () => { void load() })
onMounted(() => { void load() })
</script>

<template>
  <section class="direct-message-panel" :aria-label="`与 ${targetName} 私聊`">
    <div class="direct-message-panel__heading">与 {{ targetName }} 私聊</div>
    <p v-if="loading" class="direct-message-panel__note">正在加载消息…</p>
    <p v-if="error" class="direct-message-panel__error" role="alert">{{ error }}</p>
    <p v-if="!loading && messages.length === 0" class="direct-message-panel__note">还没有消息，发送第一句问候吧。</p>
    <ol v-else-if="!loading" class="direct-message-panel__messages" aria-live="polite">
      <li
        v-for="message in messages"
        :key="message.id"
        class="direct-message-panel__message"
        :class="{ 'direct-message-panel__message--mine': message.sender_actor === auth.user.value?.actor }"
      >
        <strong>{{ message.sender_actor === auth.user.value?.actor ? '你' : targetName }}</strong>
        <span>{{ message.body }}</span>
        <time :datetime="message.created_at">{{ new Date(message.created_at).toLocaleString() }}</time>
      </li>
    </ol>
    <form class="direct-message-panel__compose" @submit.prevent="send">
      <textarea v-model="draft" maxlength="2000" rows="2" placeholder="写一条私信" aria-label="私信内容" />
      <WinButton type="submit" Style="AccentButtonStyle" :IsEnabled="Boolean(draft.trim()) && !sending">{{ sending ? '发送中…' : '发送' }}</WinButton>
    </form>
  </section>
</template>

<style scoped>
.direct-message-panel { width: 100%; display: flex; flex-direction: column; gap: .45rem; margin-top: .65rem; padding-top: .65rem; border-top: 1px solid var(--stroke-divider); }
.direct-message-panel__heading { color: var(--text-primary); font-size: .78rem; font-weight: 600; }
.direct-message-panel__note, .direct-message-panel__error { margin: 0; color: var(--text-secondary); font-size: .72rem; }
.direct-message-panel__error { color: var(--critical-text); }
.direct-message-panel__messages { max-height: 10rem; display: flex; flex-direction: column; gap: .35rem; margin: 0; padding: 0; overflow-y: auto; list-style: none; }
.direct-message-panel__message { display: flex; flex-direction: column; gap: .12rem; padding: .4rem .5rem; border-radius: var(--radius-sm); background: var(--card-bg); color: var(--text-primary); font-size: .74rem; overflow-wrap: anywhere; }
.direct-message-panel__message--mine { margin-left: 1rem; background: color-mix(in srgb, var(--accent-fill) 18%, var(--card-bg)); }
.direct-message-panel__message strong { color: var(--text-secondary); font-size: .65rem; font-weight: 600; }
.direct-message-panel__message time { color: var(--text-tertiary); font-size: .62rem; }
.direct-message-panel__compose { display: flex; align-items: end; gap: .4rem; }
.direct-message-panel__compose textarea { min-width: 0; flex: 1; resize: none; padding: .4rem .5rem; border: 1px solid var(--control-stroke); border-radius: var(--radius-sm); background: var(--control-fill); color: var(--text-primary); font: inherit; font-size: .74rem; }
</style>
