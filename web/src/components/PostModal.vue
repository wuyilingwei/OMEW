<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { usePostModal } from '../composables/usePostModal'
import { WinButton } from '../vendor/winui'
import AvatarBadge from './AvatarBadge.vue'

const { openPost, close } = usePostModal()

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && openPost.value) close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="openPost" class="post-modal-overlay" @click.self="close">
      <div class="post-modal" role="dialog" aria-modal="true" :aria-label="openPost.title">
        <WinButton Style="SubtleButtonStyle" class="post-modal__close" @Click="close">关闭</WinButton>
        <div class="post-modal__scroll">
          <img v-if="openPost.cover" class="post-modal__cover" :src="openPost.cover" :alt="openPost.title" />
          <div class="post-modal__body">
            <h1 class="post-modal__title">{{ openPost.title }}</h1>
            <div class="post-modal__author-row">
              <AvatarBadge :seed="openPost.avatar" :size="36" />
              <div class="post-modal__author-meta">
                <span class="post-modal__author-name">{{ openPost.author }}</span>
                <span class="post-modal__time">{{ openPost.timestamp }}</span>
              </div>
            </div>
            <p v-for="(paragraph, index) in openPost.content.split('\n\n')" :key="index" class="post-modal__paragraph">
              {{ paragraph }}
            </p>
            <div class="post-modal__comments">
              <h2 class="post-modal__comments-title">评论</h2>
              <p class="post-modal__comments-empty">暂无评论，来说两句吧。</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.post-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: rgba(0, 0, 0, 0.5);
}

.post-modal {
  position: relative;
  width: 56%;
  min-width: 320px;
  max-width: 720px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-md);
  background: var(--flyout-bg, var(--layer-default));
  border: 1px solid var(--card-stroke);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(32px) saturate(160%);
  -webkit-backdrop-filter: blur(32px) saturate(160%);
  overflow: hidden;
}

.post-modal__close {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
  z-index: 1;
}

.post-modal__scroll {
  overflow-y: auto;
}

.post-modal__cover {
  width: 100%;
  height: 220px;
  object-fit: cover;
}

.post-modal__body {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1.5rem 1.75rem 2rem;
}

.post-modal__title {
  margin: 0;
  padding-right: 3rem;
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--text-primary);
}

.post-modal__author-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.post-modal__author-meta {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.post-modal__author-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.post-modal__time {
  font-size: 0.72rem;
  color: var(--text-tertiary);
}

.post-modal__paragraph {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--text-secondary);
  white-space: pre-wrap;
}

.post-modal__comments {
  margin-top: 0.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--stroke-divider);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.post-modal__comments-title {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.post-modal__comments-empty {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-tertiary);
}

@media (max-width: 768px) {
  .post-modal-overlay {
    padding: 0;
  }

  .post-modal {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    border-radius: 0;
  }
}
</style>
