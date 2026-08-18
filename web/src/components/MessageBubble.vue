<script setup lang="ts">
import type { ChatMessage } from '../types/models'

defineProps<{ message: ChatMessage }>()
</script>

<template>
  <div class="message-row" :class="{ 'message-row--mine': message.mine }">
    <div class="message-bubble" :class="{ 'message-bubble--mine': message.mine }">
      <div v-if="!message.mine" class="message-bubble__author">{{ message.author }}</div>
      <div class="message-bubble__content">{{ message.content }}</div>
      <div class="message-bubble__time">{{ message.timestamp }}</div>
    </div>
  </div>
</template>

<style scoped>
.message-row {
  display: flex;
  justify-content: flex-start;
}

.message-row--mine {
  justify-content: flex-end;
}

.message-bubble {
  max-width: 60%;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  color: var(--text-primary);
}

.message-bubble--mine {
  background: var(--accent-base);
  border-color: transparent;
  color: var(--accent-text);
}

.message-bubble__author {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-bottom: 0.15rem;
}

.message-bubble__content {
  font-size: 0.9rem;
  line-height: 1.4;
}

.message-bubble--mine .message-bubble__content {
  color: inherit;
}

.message-bubble__time {
  font-size: 0.7rem;
  color: var(--text-tertiary);
  margin-top: 0.2rem;
  text-align: right;
}

.message-bubble--mine .message-bubble__time {
  color: var(--accent-text-secondary);
}
</style>
