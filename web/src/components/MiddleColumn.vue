<script setup lang="ts">
import { ref } from 'vue'
import { mockChannels } from '../data/mock'
import type { ChannelSummary } from '../types/models'
import ChannelSwitcher from './ChannelSwitcher.vue'
import ChatPane from './ChatPane.vue'

const selectedChannel = ref<ChannelSummary>(mockChannels.find((channel) => channel.active) ?? mockChannels[0])
</script>

<template>
  <main class="middle-column">
    <div class="middle-column__header">
      <ChannelSwitcher v-model="selectedChannel" :channels="mockChannels" />
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
  padding: 0.6rem 1rem;
  background: var(--layer-default);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border-bottom: 1px solid var(--stroke-divider);
}
</style>
