<script setup lang="ts">
import { computed, ref } from 'vue'
import { DEFAULT_NODE_PAGE_BG, EMPTY_STATE } from '../assets/mew'
import { useAuth } from '../composables/useAuth'
import { useAuthModal } from '../composables/useAuthModal'
import { useSectionRoom } from '../composables/useSectionRoom'
import { useStronghold } from '../composables/useStronghold'
import { useStrongholdConfig } from '../composables/useStrongholdConfig'
import { WinButton } from '../vendor/winui'
import ComposePostModal from './ComposePostModal.vue'
import EmptyState from './EmptyState.vue'
import PostCard from './PostCard.vue'

const auth = useAuth()
const { openAuthModal } = useAuthModal()
const { isReadOnly } = useStronghold()
const { posts, postsLoading, hasMorePosts, loadMorePosts, postRoom, toggleReaction } = useSectionRoom()
const { currentNode } = useStronghold()
const { config } = useStrongholdConfig()

const showCompose = ref(false)
const canParticipate = computed(() => auth.isAuthenticated.value && !isReadOnly.value)

const strongholdName = computed(() => config.value?.name ?? currentNode.value?.name ?? '')
const strongholdDescription = computed(() => config.value?.description ?? '')
const strongholdAvatar = computed(() => config.value?.avatar ?? currentNode.value?.avatar ?? null)
const strongholdCover = computed(() => config.value?.cover || currentNode.value?.cover || DEFAULT_NODE_PAGE_BG)

function openCompose() {
  showCompose.value = true
}

function closeCompose() {
  showCompose.value = false
}
</script>

<template>
  <aside class="left-column">
    <div class="left-column__stronghold">
      <img v-if="strongholdCover" class="left-column__cover" :src="strongholdCover" :alt="strongholdName" />
      <div class="left-column__stronghold-body">
        <div class="left-column__stronghold-heading">
          <img v-if="strongholdAvatar" class="left-column__avatar" :src="strongholdAvatar" alt="" />
          <h2 class="left-column__stronghold-name">{{ strongholdName }}</h2>
        </div>
        <p class="left-column__stronghold-description">{{ strongholdDescription }}</p>
      </div>
    </div>

    <div class="left-column__header">
      <div class="left-column__header-row">
        <WinButton
          v-if="postRoom && canParticipate"
          Style="AccentButtonStyle"
          class="left-column__compose-btn"
          @click="openCompose"
        >
          发帖
        </WinButton>
        <WinButton v-else-if="postRoom && !auth.isAuthenticated.value" Style="DefaultButtonStyle" class="left-column__compose-btn" @click="openAuthModal">
          登录后发帖
        </WinButton>
        <span v-else-if="postRoom" class="left-column__preview-hint">加入后发帖</span>
      </div>
    </div>

    <ComposePostModal :open="showCompose" @close="closeCompose" />

    <div class="left-column__feed">
      <PostCard
        v-for="post in posts"
        :key="post.post_seq"
        :post="post"
        @toggle-reaction="toggleReaction(post.post_seq, $event)"
      />
      <EmptyState v-if="!posts.length && !postsLoading" :image="EMPTY_STATE.posts" text="暂无帖子" />
      <div v-if="hasMorePosts" class="left-column__more">
        <WinButton Style="SubtleButtonStyle" :IsEnabled="!postsLoading" @click="loadMorePosts">
          {{ postsLoading ? '加载中…' : '加载更多' }}
        </WinButton>
      </div>
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
  overflow: hidden;
}

.left-column__header {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.75rem 1rem;
  color: var(--text-primary);
  background: var(--app-bg);
  border-bottom: 1px solid var(--stroke-divider);
}

.left-column__stronghold {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  margin: 0.75rem 0.75rem 0;
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  overflow: hidden;
}

.left-column__cover {
  width: 100%;
  height: 96px;
  object-fit: cover;
}

.left-column__stronghold-body {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.75rem 0.85rem;
}

.left-column__stronghold-heading {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.left-column__avatar {
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--card-stroke);
}

.left-column__stronghold-name {
  margin: 0;
  font-size: 0.98rem;
  font-weight: 600;
  color: var(--text-primary);
}

.left-column__stronghold-description {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.5;
  color: var(--text-secondary);
}

.left-column__header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-height: 2rem;
}

.left-column__compose-btn {
  font-size: 0.78rem;
}

.left-column__preview-hint {
  font-size: 0.78rem;
  font-weight: 400;
  color: var(--text-tertiary);
}

.left-column__feed {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0 0.75rem 1rem;
  overflow-y: auto;
}

.left-column__more {
  display: flex;
  justify-content: center;
  padding: 0.5rem 0;
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
