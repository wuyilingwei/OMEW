<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useImageAttachments } from '../composables/useImageAttachments'
import { useSection } from '../composables/useSection'
import { useSectionRoom } from '../composables/useSectionRoom'
import { resolveSectionTarget } from '../utils/contentMetadata'
import { filterImageFiles } from '../utils/imageProcessing'
import { requiredError, requiredMaxLengthError } from '../utils/validate'
import { WinButton, WinDropDownButton, WinInfoBar } from '../vendor/winui'
import CoverUploader from './CoverUploader.vue'
import ImageEditor from './ImageEditor.vue'
import AppIcon from './icons/AppIcon.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const auth = useAuth()
const { createPost } = useSectionRoom()
const { sectionRooms, selectedSection, selectSection } = useSection()
const attachments = useImageAttachments()

const form = reactive({ title: '', text: '', cover: '' })
const targetSectionId = ref('')
const targetSection = computed(() => resolveSectionTarget(sectionRooms.value, targetSectionId.value, selectedSection.value?.id ?? ''))
const composeError = ref('')
const imageInput = ref<HTMLInputElement | null>(null)
const imageQueue = ref<File[]>([])
const editingImage = ref<File | null>(null)

const isDirty = computed(
  () =>
    form.title.trim() !== '' ||
    form.text.trim() !== '' ||
    form.cover !== '' ||
    attachments.items.value.length > 0,
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

async function submitPost() {
  const titleError = requiredMaxLengthError(form.title, 64, '标题')
  const textError = requiredError(form.text, '正文')
  if (titleError || textError) {
    composeError.value = [titleError, textError].filter(Boolean).join('；')
    return
  }
  // Let useSectionRoom's watcher close the previous section transport before
  // attempting the create frame; otherwise a fast click could post to the
  // previously selected room.
  await nextTick()
  const media = attachments.items.value.length ? [...attachments.items.value] : undefined
  const ok = createPost(form.title, form.text, form.cover, media)
  if (!ok) {
    composeError.value = '发送失败，连接尚未就绪，请稍后再试'
    return
  }
  resetForm()
  emit('close')
}

const sectionFlyout = computed(() => ({
  Items: sectionRooms.value.map((room) => ({ Text: room.name, Value: room.id })),
}))

function onSelectSection(item: { Value: string }) {
  const room = sectionRooms.value.find((candidate) => candidate.id === item.Value)
  if (!room) return
  targetSectionId.value = room.id
  // The section singleton owns the post-room transport. Selecting here keeps
  // the draft local to this modal while the room connection is switched.
  selectSection(room)
}

function pickImages() {
  imageInput.value?.click()
}

function onImageInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) queueImages(input.files)
  input.value = ''
}

function onTextPaste(event: ClipboardEvent) {
  const files = [...(event.clipboardData?.items ?? [])]
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file != null)
  if (files.length) {
    event.preventDefault()
    queueImages(files)
  }
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  const files = [...(event.dataTransfer?.files ?? [])]
  if (files.length) queueImages(files)
}

async function queueImages(files: Iterable<File>) {
  const { accepted, rejected } = await filterImageFiles(files)
  if (rejected) attachments.error.value = '仅支持图片文件'
  imageQueue.value.push(...accepted)
  if (!editingImage.value) editingImage.value = imageQueue.value.shift() ?? null
}

async function confirmImage(blob: Blob) {
  await attachments.addProcessed(blob)
  editingImage.value = imageQueue.value.shift() ?? null
}

function cancelImage() {
  editingImage.value = imageQueue.value.shift() ?? null
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) requestClose()
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      composeError.value = ''
      targetSectionId.value = selectedSection.value?.id ?? ''
    }
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
            <WinButton Style="SubtleButtonStyle" class="compose-modal__close" @click="requestClose">关闭</WinButton>
          </div>

          <div class="compose-modal__scroll">
            <div class="field">
              <input v-model="form.title" type="text" maxlength="64" placeholder="标题（≤64 字）" />
            </div>
            <div class="field">
              <textarea v-model="form.text" class="field__textarea--fixed" rows="6" placeholder="正文" @paste="onTextPaste"></textarea>
            </div>
            <div class="field">
              <span class="field__label">发布到话题组</span>
              <WinDropDownButton
                class="compose-modal__section-picker"
                :Flyout="sectionFlyout"
                :IsEnabled="sectionRooms.length > 0"
                @Select="onSelectSection"
              >
                <span>{{ targetSection?.name ?? '选择话题组' }}</span>
              </WinDropDownButton>
            </div>
            <div class="field">
              <span class="field__label">封面（可选）</span>
              <CoverUploader v-if="auth.token.value" v-model="form.cover" :token="auth.token.value" crop-label="帖子封面 16:9" :crop-ratio="16 / 9" />
            </div>
            <div class="field">
              <span class="field__label">配图（可选）</span>
              <input ref="imageInput" class="compose-modal__image-input" type="file" accept="image/*" multiple @change="onImageInputChange" />
              <div class="compose-modal__images">
                <div v-for="item in attachments.items.value" :key="item.id" class="compose-modal__image">
                  <img :src="item.url" alt="" />
                  <button type="button" class="compose-modal__image-remove" title="移除" @click="attachments.remove(item.id)">
                    <AppIcon name="close" :size="10" />
                  </button>
                </div>
                <WinButton Style="DefaultButtonStyle" :IsEnabled="!attachments.uploading.value" @click="pickImages">
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
            <WinButton Style="SubtleButtonStyle" @click="requestClose">取消</WinButton>
            <WinButton Style="AccentButtonStyle" @click="submitPost">发布</WinButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
  <ImageEditor :file="editingImage" :uploading="attachments.uploading.value" @confirm="confirmImage" @cancel="cancelImage" />
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
  background: var(--overlay-scrim);
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
  box-shadow: var(--shadow-dialog);
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

.compose-modal__section-picker {
  align-self: flex-start;
  max-width: 100%;
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
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: var(--overlay-scrim-strong);
  color: var(--text-on-dark);
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
    background: var(--dialog-background);
  }
}
</style>
