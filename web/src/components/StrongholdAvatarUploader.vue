<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { api, ApiRequestError } from '../api'
import { useStorageUsage } from '../composables/useStorageUsage'
import { fileUploadError } from '../utils/validate'
import { WinButton } from '../vendor/winui'

const props = defineProps<{ modelValue: string; token: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const OUTPUT_SIZE = 512
const error = ref('')
const uploading = ref(false)
const progress = ref(0)
const fileInput = ref<HTMLInputElement | null>(null)
const preview = ref<HTMLCanvasElement | null>(null)
const source = ref<HTMLImageElement | null>(null)
const sourceUrl = ref('')
const cropOpen = ref(false)
const zoom = ref(1)
const x = ref(0.5)
const y = ref(0.5)
const { usage, noteUploaded } = useStorageUsage()

const canCrop = computed(() => source.value !== null)

function pickFile() {
  fileInput.value?.click()
}

function releaseSource() {
  if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value)
  sourceUrl.value = ''
  source.value = null
}

function draw(canvas: HTMLCanvasElement) {
  const image = source.value
  if (!image) return
  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const scale = Math.max(OUTPUT_SIZE / image.naturalWidth, OUTPUT_SIZE / image.naturalHeight) * zoom.value
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  ctx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, -(width - OUTPUT_SIZE) * x.value, -(height - OUTPUT_SIZE) * y.value, width, height)
}

async function refreshPreview() {
  await nextTick()
  if (preview.value) draw(preview.value)
}

watch([zoom, x, y], () => void refreshPreview())

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const preflight = fileUploadError(file, usage.value)
  if (preflight) {
    error.value = preflight
    return
  }
  error.value = ''
  releaseSource()
  const url = URL.createObjectURL(file)
  sourceUrl.value = url
  const image = new Image()
  image.onload = async () => {
    if (sourceUrl.value !== url) return
    source.value = image
    zoom.value = 1
    x.value = 0.5
    y.value = 0.5
    cropOpen.value = true
    await refreshPreview()
  }
  image.onerror = () => {
    if (sourceUrl.value !== url) return
    error.value = '无法读取这张图片'
    releaseSource()
  }
  image.src = url
}

function closeCrop() {
  if (uploading.value) return
  cropOpen.value = false
  releaseSource()
}

onBeforeUnmount(releaseSource)

async function uploadCrop() {
  if (!preview.value || !source.value) return
  uploading.value = true
  error.value = ''
  draw(preview.value)
  try {
    const blob = await new Promise<Blob | null>((resolve) => preview.value?.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob) throw new Error('crop failed')
    const file = new File([blob], 'stronghold-avatar.jpg', { type: 'image/jpeg' })
    const result = await api.uploadMedia(props.token, file, (pct) => { progress.value = pct })
    noteUploaded(result.size)
    emit('update:modelValue', result.url)
    cropOpen.value = false
    releaseSource()
  } catch (err) {
    const messages: Record<string, string> = { FILE_TOO_LARGE: '文件超过实例大小限制', QUOTA_EXCEEDED: '你的存储配额已用尽', MIME_REJECTED: '不支持的文件类型' }
    error.value = err instanceof ApiRequestError ? (messages[err.code] ?? '上传失败，请稍后重试') : '裁剪或上传失败，请稍后重试'
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="avatar-uploader">
    <div class="avatar-uploader__row">
      <img v-if="modelValue" class="avatar-uploader__current" :src="modelValue" alt="当前据点头像" />
      <span v-else class="avatar-uploader__placeholder" aria-hidden="true">头像</span>
      <input ref="fileInput" class="avatar-uploader__file-input" type="file" accept="image/*" @change="onFileChange" />
      <WinButton Style="DefaultButtonStyle" :IsEnabled="!uploading" @click="pickFile">选择图片</WinButton>
      <WinButton v-if="modelValue" Style="SubtleButtonStyle" :IsEnabled="!uploading" @click="emit('update:modelValue', '')">移除</WinButton>
    </div>
    <p v-if="error" class="field__error" role="alert">{{ error }}</p>

    <Teleport to="body">
      <div v-if="cropOpen" class="avatar-uploader__overlay" @click.self="closeCrop">
        <section class="avatar-uploader__dialog" role="dialog" aria-modal="true" aria-labelledby="avatar-crop-title" @keydown.esc="closeCrop">
          <h3 id="avatar-crop-title">裁剪据点头像</h3>
          <p>拖动以下控件决定方形头像的取景范围。</p>
          <canvas ref="preview" class="avatar-uploader__preview" width="512" height="512" aria-label="头像裁剪预览" />
          <div class="avatar-uploader__controls" :aria-disabled="!canCrop">
            <label>缩放 <input v-model.number="zoom" type="range" min="1" max="3" step="0.01" /></label>
            <label>水平位置 <input v-model.number="x" type="range" min="0" max="1" step="0.01" /></label>
            <label>垂直位置 <input v-model.number="y" type="range" min="0" max="1" step="0.01" /></label>
          </div>
          <div class="avatar-uploader__actions">
            <WinButton Style="SubtleButtonStyle" :IsEnabled="!uploading" @click="closeCrop">取消</WinButton>
            <WinButton Style="AccentButtonStyle" :IsEnabled="canCrop && !uploading" @click="uploadCrop">{{ uploading ? `上传中…${progress}%` : '裁剪并上传' }}</WinButton>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.avatar-uploader__row, .avatar-uploader__actions { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.avatar-uploader__current, .avatar-uploader__placeholder { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; border: 1px solid var(--card-stroke); }
.avatar-uploader__placeholder { display: grid; place-items: center; font-size: 0.75rem; color: var(--text-secondary); background: var(--ctrl-fill-secondary); }
.avatar-uploader__file-input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.avatar-uploader__overlay { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 1rem; background: var(--overlay-scrim); }
.avatar-uploader__dialog { width: min(100%, 430px); display: flex; flex-direction: column; gap: 0.75rem; padding: 1.25rem; border: 1px solid var(--card-stroke); border-radius: var(--radius-md); background: var(--flyout-bg, var(--layer-default)); box-shadow: var(--shadow-dialog); }
.avatar-uploader__dialog h3, .avatar-uploader__dialog p { margin: 0; }
.avatar-uploader__dialog p { color: var(--text-secondary); font-size: 0.85rem; }
.avatar-uploader__preview { width: min(100%, 320px); aspect-ratio: 1; align-self: center; border-radius: var(--radius-sm); background: var(--ctrl-fill-secondary); }
.avatar-uploader__controls { display: grid; gap: 0.5rem; }
.avatar-uploader__controls label { display: grid; grid-template-columns: 5.5rem 1fr; align-items: center; gap: 0.5rem; font-size: 0.85rem; }
.avatar-uploader__controls input { width: 100%; }
.avatar-uploader__actions { justify-content: flex-end; }
</style>
