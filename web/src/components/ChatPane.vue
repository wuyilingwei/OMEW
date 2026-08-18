<script setup lang="ts">
import { mockMessages } from '../data/mock'
import MessageBubble from './MessageBubble.vue'
</script>

<template>
  <section class="chat-pane">
    <div class="chat-pane__header">综合讨论</div>
    <div class="chat-pane__messages">
      <MessageBubble v-for="message in mockMessages" :key="message.id" :message="message" />
    </div>
    <div class="chat-pane__compose">
      <div class="chat-pane__input" contenteditable="false">说点什么…</div>
      <button class="chat-pane__send" type="button">发送</button>
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

.chat-pane__header {
  flex: 0 0 auto;
  padding: 0.75rem 1rem;
  background: rgb(var(--colors-background-darker));
  color: rgb(var(--colors-emphasis));
  font-weight: 600;
}

.chat-pane__messages {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  background: rgb(var(--colors-background-lighter));
}

.chat-pane__compose {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: rgb(var(--colors-background-morelighter));
}

.chat-pane__input {
  flex: 1 1 auto;
  min-height: 40px;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-xs);
  background: rgb(var(--colors-background-lighter));
  color: rgb(var(--colors-body));
  display: flex;
  align-items: center;
}

.chat-pane__send {
  border: none;
  border-radius: var(--radius-xs);
  padding: 0.5rem 1rem;
  background: rgb(var(--colors-primary));
  color: rgb(var(--colors-gray-900));
  font-weight: 500;
}

.chat-pane__send:hover {
  background: rgb(var(--colors-primary-darker));
}
</style>
