<script setup lang="ts">
import { mockMessages } from '../data/mock'
import type { ChannelSummary } from '../types/models'
import { WinButton } from '../vendor/winui'
import MessageBubble from './MessageBubble.vue'

defineProps<{ channel: ChannelSummary }>()
</script>

<template>
  <section class="chat-pane">
    <div class="chat-pane__messages">
      <MessageBubble v-for="message in mockMessages" :key="message.id" :message="message" />
    </div>
    <div class="chat-pane__compose">
      <div class="chat-pane__input" contenteditable="false">说点什么…</div>
      <WinButton Style="AccentButtonStyle" class="chat-pane__send">发送</WinButton>
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
  gap: 0.6rem;
}

.chat-pane__compose {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--layer-default);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border-top: 1px solid var(--stroke-divider);
}

.chat-pane__input {
  flex: 1 1 auto;
  min-height: 40px;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  background: var(--ctrl-fill-default);
  border: 1px solid var(--ctrl-border);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
}
</style>
