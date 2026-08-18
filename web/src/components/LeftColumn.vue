<script setup lang="ts">
import { mockChannels } from '../data/mock'
</script>

<template>
  <aside class="left-column">
    <div class="left-column__header">想法 / 消息</div>
    <ul class="left-column__list">
      <li v-for="channel in mockChannels" :key="channel.id">
        <button
          class="left-column__item"
          :class="{ 'left-column__item--active': channel.active }"
          type="button"
        >
          <div class="left-column__item-top">
            <span class="left-column__name">{{ channel.name }}</span>
            <span class="left-column__time">{{ channel.timestamp }}</span>
          </div>
          <div class="left-column__item-bottom">
            <span class="left-column__preview">{{ channel.preview }}</span>
            <span v-if="channel.unread" class="left-column__badge">{{ channel.unread }}</span>
          </div>
        </button>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.left-column {
  flex: 0 0 var(--left-width);
  width: var(--left-width);
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: rgb(var(--colors-background-lighter));
  border-right: 1px solid rgb(var(--colors-background-gray));
  overflow-y: auto;
}

.left-column__header {
  padding: 1rem;
  font-weight: 600;
  color: rgb(var(--colors-emphasis));
}

.left-column__list {
  list-style: none;
  margin: 0;
  padding: 0 0.5rem;
}

.left-column__item {
  width: 100%;
  text-align: left;
  border: none;
  border-radius: var(--radius-xs);
  padding: 0.6rem 0.75rem;
  margin-bottom: 0.25rem;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.left-column__item:hover {
  background: rgb(var(--colors-background-hover));
}

.left-column__item--active {
  background: rgb(var(--colors-background-selected-comment) / 0.35);
}

.left-column__item-top,
.left-column__item-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.left-column__name {
  color: rgb(var(--colors-receive-msg));
  font-weight: 500;
}

.left-column__time {
  color: rgb(var(--colors-body));
  font-size: 0.75rem;
  flex-shrink: 0;
}

.left-column__preview {
  color: rgb(var(--colors-body));
  font-size: 0.85rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.left-column__badge {
  flex-shrink: 0;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: rgb(var(--colors-primary));
  color: rgb(var(--colors-gray-900));
  font-size: 0.7rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
