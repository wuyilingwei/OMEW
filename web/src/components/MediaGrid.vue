<script setup lang="ts">
import { ref } from 'vue'
import type { MediaAttachment } from '../api/types'

defineProps<{ media: MediaAttachment[] }>()

const lightboxUrl = ref<string | null>(null)
</script>

<template>
  <div v-if="media?.length" class="media-grid">
    <button
      v-for="item in media"
      :key="item.id"
      type="button"
      class="media-grid__item"
      @click="lightboxUrl = item.url"
    >
      <img :src="item.url" alt="" loading="lazy" />
    </button>
  </div>

  <Teleport to="body">
    <div v-if="lightboxUrl" class="media-lightbox" @click="lightboxUrl = null">
      <img :src="lightboxUrl" alt="" @click.stop />
    </div>
  </Teleport>
</template>

<style scoped>
.media-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.35rem;
}

.media-grid__item {
  padding: 0;
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-xs);
  background: var(--ctrl-fill-secondary);
  overflow: hidden;
  cursor: zoom-in;
}

.media-grid__item img {
  display: block;
  width: 140px;
  height: 140px;
  object-fit: cover;
}

.media-lightbox {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  background: rgba(0, 0, 0, 0.75);
  cursor: zoom-out;
}

.media-lightbox img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--radius-sm);
  cursor: default;
}

@media (max-width: 768px) {
  .media-grid__item img {
    width: 100px;
    height: 100px;
  }

  .media-lightbox {
    padding: 1rem;
  }
}
</style>
