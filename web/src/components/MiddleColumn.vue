<script setup lang="ts">
import { useChannel } from '../composables/useChannel'
import ChatPane from './ChatPane.vue'

const { selectedChannel } = useChannel()
</script>

<template>
  <main class="middle-column">
    <div class="middle-column__header">
      <h1 class="middle-column__name">{{ selectedChannel.name }}</h1>
      <p class="middle-column__description">{{ selectedChannel.description }}</p>
    </div>
    <ChatPane :channel="selectedChannel" />
  </main>
</template>

<style scoped>
.middle-column {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--app-bg);
}

.middle-column__header {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.55rem 1rem;
  background: var(--layer-default);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border-bottom: 1px solid var(--stroke-divider);
}

.middle-column__name {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary);
}

.middle-column__description {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
