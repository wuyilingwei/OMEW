<script setup lang="ts">
import { computed } from 'vue'
import { mockPosts, mockTopicGroups } from '../data/mock'
import PostCard from './PostCard.vue'

const groups = computed(() =>
  mockTopicGroups.map((group) => ({
    group,
    posts: mockPosts.filter((post) => post.topicGroupId === group.id),
  })),
)
</script>

<template>
  <aside class="left-column">
    <div class="left-column__header">帖子</div>
    <div class="left-column__feed">
      <section v-for="{ group, posts } in groups" :key="group.id" class="left-column__group">
        <h2 class="left-column__group-title">{{ group.name }}</h2>
        <div class="left-column__group-posts">
          <PostCard v-for="post in posts" :key="post.id" :post="post" />
        </div>
      </section>
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
  padding: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.left-column__feed {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 0 0.75rem 1rem;
}

.left-column__group-title {
  margin: 0 0.15rem 0.5rem;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-tertiary);
  text-transform: uppercase;
}

.left-column__group-posts {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>
