<script setup lang="ts">
import { reactive, ref } from 'vue'
import { EMPTY_STATE } from '../assets/mew'
import { useAuth } from '../composables/useAuth'
import { useSectionRoom } from '../composables/useSectionRoom'
import { WinButton } from '../vendor/winui'
import CoverUploader from './CoverUploader.vue'
import EmptyState from './EmptyState.vue'
import PostCard from './PostCard.vue'

const auth = useAuth()
const { posts, postsLoading, hasMorePosts, loadMorePosts, createPost, postRoom } = useSectionRoom()

const showCompose = ref(false)
const form = reactive({ title: '', text: '', cover: '' })
const composeError = ref('')

function openCompose() {
  composeError.value = ''
  showCompose.value = true
}

function submitPost() {
  if (!form.title.trim() || form.title.length > 64 || !form.text.trim()) {
    composeError.value = '标题（≤64 字）和正文均为必填'
    return
  }
  const ok = createPost(form.title, form.text, form.cover)
  if (!ok) {
    composeError.value = '发送失败，连接尚未就绪，请稍后再试'
    return
  }
  form.title = ''
  form.text = ''
  form.cover = ''
  showCompose.value = false
}
</script>

<template>
  <aside class="left-column">
    <div class="left-column__header">
      <span>帖子</span>
      <WinButton v-if="postRoom" Style="SubtleButtonStyle" class="left-column__compose-btn" @Click="openCompose">
        发帖
      </WinButton>
    </div>

    <div v-if="showCompose" class="left-column__compose">
      <div class="field">
        <input v-model="form.title" type="text" maxlength="64" placeholder="标题（≤64 字）" />
      </div>
      <div class="field">
        <textarea v-model="form.text" rows="4" placeholder="正文"></textarea>
      </div>
      <div class="field">
        <span class="field__label">封面（可选）</span>
        <CoverUploader v-if="auth.token.value" v-model="form.cover" :token="auth.token.value" />
      </div>
      <p v-if="composeError" class="field__error">{{ composeError }}</p>
      <div class="left-column__compose-actions">
        <WinButton Style="SubtleButtonStyle" @Click="showCompose = false">取消</WinButton>
        <WinButton Style="AccentButtonStyle" @Click="submitPost">发布</WinButton>
      </div>
    </div>

    <div class="left-column__feed">
      <PostCard v-for="post in posts" :key="post.post_seq" :post="post" />
      <EmptyState v-if="!posts.length && !postsLoading" :image="EMPTY_STATE.posts" text="暂无帖子" />
      <div v-if="hasMorePosts" class="left-column__more">
        <WinButton Style="SubtleButtonStyle" :IsEnabled="!postsLoading" @Click="loadMorePosts">
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

.left-column__compose {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0 0.75rem 0.75rem;
}

.left-column__compose-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
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
