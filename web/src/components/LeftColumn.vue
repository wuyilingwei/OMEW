<script setup lang="ts">
import { computed, ref } from 'vue'
import { EMPTY_STATE } from '../assets/mew'
import { useAuth } from '../composables/useAuth'
import { useAuthModal } from '../composables/useAuthModal'
import { useSection } from '../composables/useSection'
import { useSectionRoom } from '../composables/useSectionRoom'
import { WinButton, WinDropDownButton } from '../vendor/winui'
import ComposePostModal from './ComposePostModal.vue'
import EmptyState from './EmptyState.vue'
import PostCard from './PostCard.vue'

const auth = useAuth()
const { openAuthModal } = useAuthModal()
const { posts, postsLoading, hasMorePosts, loadMorePosts, postRoom, toggleReaction } = useSectionRoom()
const { sectionRooms, selectedSection, selectSection } = useSection()

const showCompose = ref(false)

const sectionFlyout = computed(() => ({
  Items: sectionRooms.value.map((room) => ({ Text: room.name, Value: room.id })),
}))

function onSelectSection(item: { Value: string }) {
  const room = sectionRooms.value.find((candidate) => candidate.id === item.Value)
  if (room) selectSection(room)
}

function openCompose() {
  showCompose.value = true
}

function closeCompose() {
  showCompose.value = false
}
</script>

<template>
  <aside class="left-column">
    <div class="left-column__header">
      <WinDropDownButton
        v-if="sectionRooms.length > 1"
        class="left-column__section-switcher"
        :Flyout="sectionFlyout"
        @Select="onSelectSection"
      >
        <span class="left-column__section-label">{{ selectedSection?.name ?? '帖子' }}</span>
      </WinDropDownButton>
      <span v-else>{{ selectedSection?.name ?? '帖子' }}</span>
      <WinButton
        v-if="postRoom && auth.isAuthenticated.value"
        Style="AccentButtonStyle"
        class="left-column__compose-btn"
        @click="openCompose"
      >
        发帖
      </WinButton>
      <WinButton v-else-if="postRoom" Style="DefaultButtonStyle" class="left-column__compose-btn" @click="openAuthModal">
        登录后发帖
      </WinButton>
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
  overflow-y: auto;
}

.left-column__header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1rem 0.75rem;
  font-weight: 600;
  color: var(--text-primary);
}

.left-column__compose-btn {
  font-size: 0.78rem;
}

.left-column__section-switcher {
  font-size: 0.85rem;
}

.left-column__section-label {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.left-column__feed {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0 0.75rem 1rem;
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
