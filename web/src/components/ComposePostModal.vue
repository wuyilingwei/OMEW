<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useImageAttachments } from '../composables/useImageAttachments'
import { useSectionRoom } from '../composables/useSectionRoom'
import { requiredError, requiredMaxLengthError } from '../utils/validate'
import { WinButton, WinInfoBar } from '../vendor/winui'
import CoverUploader from './CoverUploader.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const auth = useAuth()
const { createPost } = useSectionRoom()
const attachments = useImageAttachments()

const form = reactive({ title: '', text: '', cover: '' })
const composeError = ref('')
const imageInput = ref<HTMLInputElement | null>(null)

const isDirty = computed(
  () => form.title.trim() !== '' || form.text.trim() !== '' || form.cover !== '' || attachments.items.value.length > 0,
)

function resetForm() {
  form.title = ''
  form.text = ''
  form.cover = ''
  composeError.value = ''
  attachments.reset()
}

function requestClose() {
  if (isDirty.value && !confirm('放弃这条草稿？未发布的内容不会被保存。')) return
  resetForm()
  emit('close')
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
  resetForm()
  emit('close')
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

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) requestClose()
}

watch(
  () => props.open,
  (open) => {
    if (open) composeError.value = ''
  },
)

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="compose-modal">
      <div v-if="open" class="compose-modal-overlay" @click.self="requestClose" @dragover.prevent @drop="onDrop">
        <div class="compose-modal" role="dialog" aria-modal="true">
          <div class="compose-modal__header">
            <h1 class="compose-modal__title">发帖</h1>
            <WinButton Style="SubtleButtonStyle" class="compose-modal__close" @Click="requestClose">关闭</WinButton>
          </div>

          <div class="compose-modal__scroll">
            <div class="field">
              <input v-model="form.title" type="text" maxlength="64" placeholder="标题（≤64 字）" />
            </div>
            <div class="field">
              <textarea v-model="form.text" rows="6" placeholder="正文" @paste="onTextPaste"></textarea>
            </div>
            <div class="field">
              <span class="field__label">封面（可选）</span>
              <CoverUploader v-if="auth.token.value" v-model="form.cover" :token="auth.token.value" />
            </div>
            <div class="field">
              <span class="field__label">配图（可选）</span>
              <input ref="imageInput" class="compose-modal__image-input" type="file" accept="image/*" multiple @change="onImageInputChange" />
              <div class="compose-modal__images">
                <div v-for="item in attachments.items.value" :key="item.id" class="compose-modal__image">
                  <img :src="item.url" alt="" />
                  <button type="button" class="compose-modal__image-remove" title="移除" @click="attachments.remove(item.id)">×</button>
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
          </div>

          <div class="compose-modal__actions">
            <WinButton Style="SubtleButtonStyle" @Click="requestClose">取消</WinButton>
            <WinButton Style="AccentButtonStyle" @Click="submitPost">发布</WinButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.compose-modal-overlay {
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

.compose-modal {
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

.compose-modal-enter-active,
.compose-modal-leave-active {
  transition: opacity var(--normal-duration) var(--fast-out-slow-in);
}

.compose-modal-enter-active .compose-modal,
.compose-modal-leave-active .compose-modal {
  transition:
    opacity var(--normal-duration) var(--fast-out-slow-in),
    transform var(--normal-duration) var(--fast-out-slow-in);
}

.compose-modal-enter-from,
.compose-modal-leave-to {
  opacity: 0;
}

.compose-modal-enter-from .compose-modal,
.compose-modal-leave-to .compose-modal {
  opacity: 0;
  transform: scale(0.94) translateY(12px);
}

@media (prefers-reduced-motion: reduce) {
  .compose-modal-enter-active,
  .compose-modal-leave-active,
  .compose-modal-enter-active .compose-modal,
  .compose-modal-leave-active .compose-modal {
    transition: none !important;
  }
}

.compose-modal__header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 1.1rem 1.1rem 0;
}

.compose-modal__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
}

.compose-modal__scroll {
  flex: 1 1 auto;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.9rem 1.1rem;
}

.compose-modal__actions {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0 1.1rem 1.1rem;
}

.compose-modal__image-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.compose-modal__images {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.compose-modal__image {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-xs);
  overflow: hidden;
  border: 1px solid var(--card-stroke);
  flex: 0 0 auto;
}

.compose-modal__image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.compose-modal__image-remove {
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

@media (max-width: 768px) {
  .compose-modal-overlay {
    padding: 0;
  }

  .compose-modal {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    border-radius: 0;
  }
}
</style>
