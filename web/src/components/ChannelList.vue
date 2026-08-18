<script setup lang="ts">
import type { ChannelSummary } from '../types/models'

defineProps<{ channels: ChannelSummary[]; selected: ChannelSummary }>()
const emit = defineEmits<{ select: [ChannelSummary] }>()
</script>

<template>
  <ul class="channel-list">
    <li v-for="channel in channels" :key="channel.id">
      <button
        type="button"
        class="channel-list__item"
        :class="{ 'channel-list__item--active': channel.id === selected.id }"
        @click="emit('select', channel)"
      >
        <span class="channel-list__marker" aria-hidden="true" />
        <span class="channel-list__name">{{ channel.name }}</span>
      </button>
    </li>
  </ul>
</template>

<style scoped>
.channel-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.channel-list__item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.6rem;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.85rem;
  text-align: left;
  transition: background var(--fast-duration) var(--fast-out-slow-in), color var(--fast-duration);
}

.channel-list__item:hover {
  background: var(--ctrl-fill-secondary);
  color: var(--text-primary);
}

.channel-list__marker {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: transparent;
  transition: background var(--fast-duration) var(--fast-out-slow-in);
}

.channel-list__item--active {
  background: var(--ctrl-fill-tertiary);
  color: var(--text-primary);
  font-weight: 600;
}

.channel-list__item--active .channel-list__marker {
  background: rgb(var(--colors-primary));
}

@media (max-width: 768px) {
  .channel-list__item {
    padding: 0.75rem 1rem;
  }

  .channel-list__item:active {
    background: var(--ctrl-fill-tertiary);
  }
}
</style>
