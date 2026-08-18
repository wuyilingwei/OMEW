<script setup lang="ts">
import { computed } from 'vue'
import { mockMessages } from '../data/mock'
import type { ChannelSummary } from '../types/models'
import { WinButton } from '../vendor/winui'
import MessageBubble from './MessageBubble.vue'

defineProps<{ channel: ChannelSummary }>()

// a message is "grouped" with the one before it when the same speaker
// (same author, same mine state) sent both — drives tighter spacing and
// hides the repeated avatar/author label in MessageBubble
const groupedMessages = computed(() =>
  mockMessages.map((message, index) => {
    const previous = mockMessages[index - 1]
    const grouped = previous !== undefined && previous.author === message.author && previous.mine === message.mine
    return { message, grouped }
  }),
)
</script>

<template>
  <section class="chat-pane">
    <div class="chat-pane__messages">
      <MessageBubble
        v-for="entry in groupedMessages"
        :key="entry.message.id"
        :message="entry.message"
        :grouped="entry.grouped"
      />
    </div>
    <div class="chat-pane__compose">
      <textarea class="chat-pane__input" rows="1" placeholder="说点什么…"></textarea>
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
  /* vertical rhythm between rows now lives in MessageBubble's own margin
     (grouped vs. ungrouped), so no uniform gap here */
}

.chat-pane__compose {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-end;
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
