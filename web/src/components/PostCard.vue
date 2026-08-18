<script setup lang="ts">
import type { Post } from '../types/models'
import { usePostModal } from '../composables/usePostModal'
import AvatarBadge from './AvatarBadge.vue'

const props = defineProps<{ post: Post }>()
const { open } = usePostModal()
</script>

<template>
  <article
    class="post-card"
    :class="{ 'post-card--cover': !!post.cover }"
    role="button"
    tabindex="0"
    @click="open(props.post)"
    @keydown.enter="open(props.post)"
    @keydown.space.prevent="open(props.post)"
  >
    <img v-if="post.cover" class="post-card__cover" :src="post.cover" alt="" />
    <div class="post-card__body">
      <h3 class="post-card__title">{{ post.title }}</h3>
      <p class="post-card__preview">{{ post.preview }}</p>
      <div class="post-card__meta">
        <span class="post-card__author-group">
          <AvatarBadge :seed="post.avatar" :size="24" />
          <span class="post-card__author">{{ post.author }}</span>
        </span>
        <span class="post-card__time">{{ post.timestamp }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.post-card {
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  overflow: hidden;
  cursor: pointer;
  transition: background var(--fast-duration) var(--fast-out-slow-in);
}

.post-card:hover {
  background: var(--card-bg-secondary);
}

.post-card:focus-visible {
  outline: 2px solid rgb(var(--colors-primary));
  outline-offset: -2px;
}

.post-card__cover {
  width: 100%;
  height: var(--feed-cover-height);
  object-fit: cover;
}

.post-card__body {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.75rem 0.9rem;
}

.post-card__title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary);
}

.post-card__preview {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.post-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.72rem;
  color: var(--text-tertiary);
}

.post-card__author-group {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
</style>
