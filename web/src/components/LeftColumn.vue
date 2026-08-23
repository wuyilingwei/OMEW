<script setup lang="ts">
import { ref } from 'vue'
import { EMPTY_STATE } from '../assets/mew'
import { useAuth } from '../composables/useAuth'
import { useAuthModal } from '../composables/useAuthModal'
import { useSection } from '../composables/useSection'
import { useSectionRoom } from '../composables/useSectionRoom'
import { WinButton } from '../vendor/winui'
import ComposePostModal from './ComposePostModal.vue'
import EmptyState from './EmptyState.vue'
import PostCard from './PostCard.vue'

const auth = useAuth()
const { openAuthModal } = useAuthModal()
const { posts, postsLoading, hasMorePosts, loadMorePosts, postRoom, toggleReaction } = useSectionRoom()
const { sectionRooms, selectedSection, selectSection } = useSection()

const showCompose = ref(false)

function onSectionKeydown(event: KeyboardEvent, index: number) {
  if (!sectionRooms.value.length) return

  let nextIndex = index
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % sectionRooms.value.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + sectionRooms.value.length) % sectionRooms.value.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = sectionRooms.value.length - 1
  else return

  event.preventDefault()
  const room = sectionRooms.value[nextIndex]
  selectSection(room)
  const target = event.currentTarget as HTMLElement
  target.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus()
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
      <div class="left-column__section-nav" role="tablist" aria-label="帖子话题组">
        <WinButton
          v-for="(room, index) in sectionRooms"
          :key="room.id"
          Style="DefaultButtonStyle"
          class="left-column__section-button"
          :class="{ 'is-selected': selectedSection?.id === room.id }"
          role="tab"
          :aria-selected="selectedSection?.id === room.id"
          :aria-label="`切换到话题组 ${room.name}`"
          @click="selectSection(room)"
          @keydown="onSectionKeydown($event, index)"
        >
          <span class="left-column__section-label">{{ room.name }}</span>
        </WinButton>
        <span v-if="!sectionRooms.length" class="left-column__section-empty">帖子</span>
      </div>
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

.left-column__section-nav {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  gap: 0.35rem;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--ctrl-border) transparent;
  padding: 0.1rem 0 0.2rem;
}

.left-column__section-button {
  flex: 0 0 auto;
  min-width: 0;
  max-width: 12rem;
  font-size: 0.82rem;
  border-radius: 999px;
}

.left-column__section-button.is-selected {
  --ButtonBackground: var(--accent-base);
  --ButtonBackgroundPointerOver: var(--accent-hover);
  --ButtonBackgroundPressed: var(--accent-pressed);
  --ButtonForeground: var(--accent-text);
  --ButtonBorderBrush: var(--accent-base);
  --ButtonBorderBrushTop: var(--accent-base);
  --ButtonBorderBrushBottom: var(--accent-base);
}

.left-column__section-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.left-column__section-empty {
  align-self: center;
  color: var(--text-secondary);
  font-size: 0.85rem;
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
