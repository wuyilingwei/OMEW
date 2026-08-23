<script setup lang="ts">
import { computed, ref } from 'vue'
import { EMPTY_STATE } from '../assets/mew'
import { useAuth } from '../composables/useAuth'
import { useAuthModal } from '../composables/useAuthModal'
import { useSection } from '../composables/useSection'
import { useSectionRoom } from '../composables/useSectionRoom'
import { useStronghold } from '../composables/useStronghold'
import { WinButton } from '../vendor/winui'
import ComposePostModal from './ComposePostModal.vue'
import EmptyState from './EmptyState.vue'
import PostCard from './PostCard.vue'

const auth = useAuth()
const { openAuthModal } = useAuthModal()
const { isReadOnly } = useStronghold()
const { posts, postsLoading, hasMorePosts, loadMorePosts, postRoom, toggleReaction } = useSectionRoom()
const { sectionRooms, selectedSection, selectSection } = useSection()

const showCompose = ref(false)
const canParticipate = computed(() => auth.isAuthenticated.value && !isReadOnly.value)

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
          :Style="selectedSection?.id === room.id ? 'AccentButtonStyle' : 'DefaultButtonStyle'"
          class="left-column__section-button"
          role="tab"
          :aria-selected="selectedSection?.id === room.id"
          :tabindex="selectedSection?.id === room.id ? 0 : -1"
          :aria-label="`切换到话题组 ${room.name}`"
          @click="selectSection(room)"
          @keydown="onSectionKeydown($event, index)"
        >
          <span class="left-column__section-label">{{ room.name }}</span>
        </WinButton>
        <WinButton
          v-if="!sectionRooms.length"
          Style="DefaultButtonStyle"
          class="left-column__section-button left-column__section-placeholder"
          role="tab"
          :aria-selected="false"
          :tabindex="-1"
          :IsEnabled="false"
          aria-label="暂无可用话题组"
        >
          <span class="left-column__section-label">帖子</span>
        </WinButton>
      </div>
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
  position: sticky;
  top: 0;
  z-index: 2;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1rem 0.75rem;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--app-bg);
  border-bottom: 1px solid var(--stroke-divider);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
}

.left-column__compose-btn {
  font-size: 0.78rem;
}

.left-column__preview-hint {
  font-size: 0.78rem;
  font-weight: 400;
  color: var(--text-tertiary);
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

.left-column__section-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.left-column__section-placeholder {
  cursor: default;
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
