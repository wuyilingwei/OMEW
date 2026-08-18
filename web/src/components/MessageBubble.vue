<script setup lang="ts">
import type { ChatMessage } from '../types/models'
import AvatarBadge from './AvatarBadge.vue'

defineProps<{ message: ChatMessage; grouped?: boolean }>()
</script>

<template>
  <div class="message-row" :class="{ 'message-row--mine': message.mine, 'message-row--grouped': grouped }">
    <AvatarBadge v-if="!grouped" class="message-row__avatar" :seed="message.avatar" :size="36" />
    <div v-else class="message-row__avatar-spacer" aria-hidden="true"></div>
    <div class="message-bubble" :class="{ 'message-bubble--mine': message.mine }">
      <div v-if="!message.mine && !grouped" class="message-bubble__author">{{ message.author }}</div>
      <div class="message-bubble__content">{{ message.content }}</div>
      <div class="message-bubble__time">{{ message.timestamp }}</div>
    </div>
  </div>
</template>

<style scoped>
.message-row {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  justify-content: flex-start;
  /* spacing rhythm: a new speaker gets a clear gap, consecutive messages
     from the same speaker (same author + same mine state) sit close together */
  margin-top: 0.9rem;
}

.message-row:first-child {
  margin-top: 0;
}

.message-row--grouped {
  margin-top: 0.15rem;
}

.message-row--mine {
  /* row-reverse flips the main axis: default flex-start packing already
     places content at the visual right edge; flex-end would send it left */
  flex-direction: row-reverse;
}

.message-row__avatar {
  margin-bottom: 0.1rem;
}

.message-row__avatar-spacer {
  /* keeps grouped rows aligned with ungrouped ones once the avatar is hidden;
     matches AvatarBadge's rendered size (36px) passed above */
  flex: 0 0 auto;
  width: 36px;
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
  background: rgb(var(--colors-primary));
  border-color: transparent;
  color: var(--on-accent);
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
  color: color-mix(in srgb, var(--on-accent) 70%, transparent);
}

@media (max-width: 768px) {
  .message-bubble {
    max-width: 80%;
  }
}
</style>
