<script setup lang="ts">
import { useChannel } from '../composables/useChannel'
import { useShellView } from '../composables/useShellView'
import { useStronghold } from '../composables/useStronghold'
import ChatPane from './ChatPane.vue'

const { selectedChannel } = useChannel()
const { currentNode } = useStronghold()
const { setView } = useShellView()
</script>

<template>
  <main class="middle-column">
    <div class="middle-column__header">
      <button type="button" class="middle-column__back" aria-label="返回据点" @click="setView('stronghold')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <div class="middle-column__header-text">
        <p class="middle-column__stronghold-name">{{ currentNode.name }}</p>
        <h1 class="middle-column__name">{{ selectedChannel.name }}</h1>
        <p class="middle-column__description">{{ selectedChannel.description }}</p>
      </div>
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
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 1rem;
  background: var(--layer-default);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border-bottom: 1px solid var(--stroke-divider);
}

.middle-column__header-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.middle-column__back {
  display: none;
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-secondary);
}

.middle-column__back svg {
  width: 20px;
  height: 20px;
}

.middle-column__back:active {
  background: var(--ctrl-fill-secondary);
}

.middle-column__stronghold-name {
  display: none;
  margin: 0;
  font-size: 0.72rem;
  color: var(--text-tertiary);
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

@media (max-width: 768px) {
  .middle-column {
    display: none;
  }

  .shell__body[data-view='chat'] .middle-column {
    display: flex;
    width: 100%;
    min-height: 0;
  }

  .middle-column__back {
    display: flex;
  }

  .middle-column__stronghold-name {
    display: block;
  }
}
</style>
