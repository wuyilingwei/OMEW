<script setup lang="ts">
import { mockChannels } from '../data/mock'
import { useChannel } from '../composables/useChannel'
import { useStronghold } from '../composables/useStronghold'
import ChannelList from './ChannelList.vue'

const { currentNode } = useStronghold()
const { selectedChannel, selectChannel } = useChannel()
</script>

<template>
  <aside class="right-column">
    <div class="right-column__stronghold">
      <img class="right-column__cover" :src="currentNode.cover" :alt="currentNode.name" />
      <div class="right-column__stronghold-body">
        <h2 class="right-column__stronghold-name">{{ currentNode.name }}</h2>
        <p class="right-column__stronghold-description">{{ currentNode.description }}</p>
      </div>
    </div>
    <div class="right-column__channels">
      <h3 class="right-column__channels-title">频道</h3>
      <ChannelList :channels="mockChannels" :selected="selectedChannel" @select="selectChannel" />
    </div>
  </aside>
</template>

<style scoped>
.right-column {
  flex: 0 0 var(--right-width);
  width: var(--right-width);
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  background: var(--app-bg);
  border-left: 1px solid var(--stroke-divider);
  overflow-y: auto;
}

.right-column__stronghold {
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  overflow: hidden;
}

.right-column__cover {
  width: 100%;
  height: 96px;
  object-fit: cover;
}

.right-column__stronghold-body {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.75rem 0.85rem;
}

.right-column__stronghold-name {
  margin: 0;
  font-size: 0.98rem;
  font-weight: 600;
  color: var(--text-primary);
}

.right-column__stronghold-description {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.5;
  color: var(--text-secondary);
}

.right-column__channels {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.75rem 0.5rem;
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
}

.right-column__channels-title {
  margin: 0 0.1rem 0.15rem;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-tertiary);
  text-transform: uppercase;
}
</style>
