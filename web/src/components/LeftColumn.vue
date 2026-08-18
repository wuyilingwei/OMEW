<script setup lang="ts">
import { computed, ref } from 'vue'
import { mockPosts, mockTopicGroups } from '../data/mock'
import PostCard from './PostCard.vue'

const selectedGroupId = ref<string | null>(null)

const filteredPosts = computed(() =>
  selectedGroupId.value === null
    ? mockPosts
    : mockPosts.filter((post) => post.topicGroupId === selectedGroupId.value),
)
</script>

<template>
  <aside class="left-column">
    <div class="left-column__header">帖子</div>
    <div class="left-column__filters">
      <button
        type="button"
        class="left-column__pill"
        :class="{ 'left-column__pill--active': selectedGroupId === null }"
        @click="selectedGroupId = null"
      >
        全部
      </button>
      <button
        v-for="group in mockTopicGroups"
        :key="group.id"
        type="button"
        class="left-column__pill"
        :class="{ 'left-column__pill--active': selectedGroupId === group.id }"
        @click="selectedGroupId = group.id"
      >
        {{ group.name }}
      </button>
    </div>
    <div class="left-column__feed">
      <PostCard v-for="post in filteredPosts" :key="post.id" :post="post" />
    </div>
  </aside>
</template>

<style scoped>
.left-column {
  flex: 0 0 var(--left-width);
  width: var(--left-width);
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--layer-default);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border-right: 1px solid var(--stroke-divider);
  overflow-y: auto;
}

.left-column__header {
  flex: 0 0 auto;
  padding: 1rem 1rem 0.5rem;
  font-weight: 600;
  color: var(--text-primary);
}

.left-column__filters {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0 0.75rem 0.75rem;
}

.left-column__pill {
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--ctrl-border);
  background: var(--ctrl-fill-secondary);
  color: var(--text-secondary);
  font-size: 0.78rem;
  transition: background var(--fast-duration) var(--fast-out-slow-in), color var(--fast-duration);
}

.left-column__pill:hover {
  background: var(--ctrl-fill-tertiary);
}

.left-column__pill--active {
  background: var(--accent-base);
  border-color: transparent;
  color: var(--accent-text);
}

.left-column__feed {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0 0.75rem 1rem;
}

@media (max-width: 768px) {
  .left-column {
    display: none;
  }

  .shell__body[data-view='posts'] .left-column {
    display: flex;
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    border-right: none;
  }
}
</style>
