<script setup lang="ts">
import { reactive, ref } from 'vue'
import { EMPTY_STATE } from '../assets/mew'
import { useAuth } from '../composables/useAuth'
import { useImageAttachments } from '../composables/useImageAttachments'
import { useSectionRoom } from '../composables/useSectionRoom'
import { requiredError, requiredMaxLengthError } from '../utils/validate'
import { WinButton, WinInfoBar } from '../vendor/winui'
import CoverUploader from './CoverUploader.vue'
import EmptyState from './EmptyState.vue'
import PostCard from './PostCard.vue'

const auth = useAuth()
const { posts, postsLoading, hasMorePosts, loadMorePosts, createPost, postRoom } = useSectionRoom()
const attachments = useImageAttachments()

const showCompose = ref(false)
const form = reactive({ title: '', text: '', cover: '' })
const composeError = ref('')
const imageInput = ref<HTMLInputElement | null>(null)

function openCompose() {
  composeError.value = ''
  attachments.reset()
  showCompose.value = true
}

function submitPost() {
  const titleError = requiredMaxLengthError(form.title, 64, '标题')
  const textError = requiredError(form.text, '正文')
  if (titleError || textError) {
    composeError.value = [titleError, textError].filter(Boolean).join('；')
    return
  }
  const media = attachments.items.value.length ? [...attachments.items.value] : undefined
  const ok = createPost(form.title, form.text, form.cover, media)
  if (!ok) {
    composeError.value = '发送失败，连接尚未就绪，请稍后再试'
    return
  }
  form.title = ''
  form.text = ''
  form.cover = ''
  attachments.reset()
  showCompose.value = false
}

function pickImages() {
  imageInput.value?.click()
}

function onImageInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) void attachments.addFiles(input.files)
  input.value = ''
}

function onTextPaste(event: ClipboardEvent) {
  const files = [...(event.clipboardData?.items ?? [])]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file != null)
  if (files.length) {
    event.preventDefault()
    void attachments.addFiles(files)
  }
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/'))
  if (files.length) void attachments.addFiles(files)
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

    <div v-if="showCompose" class="left-column__compose" @dragover.prevent @drop="onDrop">
      <div class="field">
        <input v-model="form.title" type="text" maxlength="64" placeholder="标题（≤64 字）" />
      </div>
      <div class="field">
        <textarea v-model="form.text" rows="4" placeholder="正文" @paste="onTextPaste"></textarea>
      </div>
      <div class="field">
        <span class="field__label">封面（可选）</span>
        <CoverUploader v-if="auth.token.value" v-model="form.cover" :token="auth.token.value" />
      </div>
      <div class="field">
        <span class="field__label">配图（可选）</span>
        <input ref="imageInput" class="left-column__image-input" type="file" accept="image/*" multiple @change="onImageInputChange" />
        <div class="left-column__compose-images">
          <div v-for="item in attachments.items.value" :key="item.id" class="left-column__compose-image">
            <img :src="item.url" alt="" />
            <button type="button" class="left-column__compose-image-remove" title="移除" @click="attachments.remove(item.id)">×</button>
          </div>
          <WinButton Style="DefaultButtonStyle" :IsEnabled="!attachments.uploading.value" @Click="pickImages">
            {{ attachments.uploading.value ? '上传中…' : '添加图片' }}
          </WinButton>
        </div>
        <p v-if="attachments.error.value" class="field__error">{{ attachments.error.value }}</p>
      </div>
      <WinInfoBar v-if="composeError" :IsOpen="true" :IsClosable="false" :IsIconVisible="false" Severity="Error">
        {{ composeError }}
      </WinInfoBar>
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

.left-column__image-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.left-column__compose-images {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.left-column__compose-image {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-xs);
  overflow: hidden;
  border: 1px solid var(--card-stroke);
  flex: 0 0 auto;
}

.left-column__compose-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.left-column__compose-image-remove {
  position: absolute;
  top: 0;
  right: 0;
  width: 16px;
  height: 16px;
  line-height: 14px;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 0.75rem;
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
