<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { api, ApiRequestError } from '../api'
import { useStorageUsage } from '../composables/useStorageUsage'
import { fileUploadError } from '../utils/validate'
import { drawSquareCrop, isGif, processImage, type ImageOutputMode } from '../utils/imageProcessing'
import { WinButton, WinToggleSwitch } from '../vendor/winui'

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
const selectedFile = ref<File | null>(null)
const mode = ref<ImageOutputMode>('webp')
const keepOriginal = computed({ get: () => mode.value === 'original', set: (value: boolean) => { mode.value = value ? 'original' : 'webp' } })
const gifPending = ref(false)
let pointerId: number | null = null
let pointerX = 0
let pointerY = 0
const { usage, noteUploaded } = useStorageUsage()

const canCrop = computed(() => source.value !== null || gifPending.value)

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
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const rendered = drawSquareCrop(image, OUTPUT_SIZE, OUTPUT_SIZE, { zoom: zoom.value, panX: x.value * 2 - 1, panY: y.value * 2 - 1 })
  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE
  ctx.drawImage(rendered, 0, 0)
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
  error.value = ''
  releaseSource()
  selectedFile.value = file
  if (await isGif(file)) {
    gifPending.value = true
    cropOpen.value = true
    return
  }
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
  gifPending.value = false
  selectedFile.value = null
  releaseSource()
}

onBeforeUnmount(releaseSource)

async function uploadCrop() {
  const file = selectedFile.value
  if (!file || (!gifPending.value && (!preview.value || !source.value))) return
  uploading.value = true
  error.value = ''
  try {
    const processed = await processImage(file, {
      mode: mode.value,
      ...(gifPending.value ? {} : { crop: { zoom: zoom.value, panX: x.value * 2 - 1, panY: y.value * 2 - 1 }, outputSize: OUTPUT_SIZE }),
    })
    const preflight = fileUploadError(processed.blob, usage.value)
    if (preflight) {
      error.value = preflight
      return
    }
    const result = await api.uploadMedia(props.token, processed.blob, (pct) => { progress.value = pct })
    noteUploaded(result.size)
    emit('update:modelValue', result.url)
    cropOpen.value = false
    gifPending.value = false
    selectedFile.value = null
    releaseSource()
    if (processed.isGif) error.value = 'GIF 为保留动画不压缩，已按原图上传'
    else if (processed.webpFallback) error.value = '此浏览器不能编码 WebP，已改用 PNG 上传'
  } catch (err) {
    const messages: Record<string, string> = { FILE_TOO_LARGE: '文件超过实例大小限制', QUOTA_EXCEEDED: '你的存储配额已用尽', MIME_REJECTED: '不支持的文件类型' }
    error.value = err instanceof ApiRequestError ? (messages[err.code] ?? '上传失败，请稍后重试') : '裁剪或上传失败，请稍后重试'
  } finally {
    uploading.value = false
  }
}

function onPointerDown(event: PointerEvent) {
  if (!source.value) return
  pointerId = event.pointerId
  pointerX = event.clientX
  pointerY = event.clientY
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (pointerId !== event.pointerId || !source.value) return
  const scale = Math.max(OUTPUT_SIZE / source.value.naturalWidth, OUTPUT_SIZE / source.value.naturalHeight) * zoom.value
  const extraX = Math.max(source.value.naturalWidth * scale - OUTPUT_SIZE, 1)
  const extraY = Math.max(source.value.naturalHeight * scale - OUTPUT_SIZE, 1)
  x.value = Math.max(0, Math.min(1, x.value + ((event.clientX - pointerX) * 2) / extraX))
  y.value = Math.max(0, Math.min(1, y.value + ((event.clientY - pointerY) * 2) / extraY))
  pointerX = event.clientX
  pointerY = event.clientY
}

function onPointerUp(event: PointerEvent) {
  if (pointerId === event.pointerId) pointerId = null
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
          <p v-if="gifPending">GIF 将保持动画并按原图上传。</p>
          <p v-else>在固定方形框内直接拖动图片调整位置。</p>
          <canvas v-if="!gifPending" ref="preview" class="avatar-uploader__preview" width="512" height="512" aria-label="头像裁剪预览" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp" />
          <div v-if="!gifPending" class="avatar-uploader__controls" :aria-disabled="!canCrop">
            <label>缩放 <input v-model.number="zoom" type="range" min="1" max="3" step="0.01" /></label>
            <label>水平位置 <input v-model.number="x" type="range" min="0" max="1" step="0.01" /></label>
            <label>垂直位置 <input v-model.number="y" type="range" min="0" max="1" step="0.01" /></label>
          </div>
          <WinToggleSwitch v-if="!gifPending" v-model="keepOriginal" OnContent="保持源格式编码" OffContent="默认压缩为 WebP" />
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
.avatar-uploader__preview { width: min(100%, 320px); aspect-ratio: 1; align-self: center; border-radius: var(--radius-sm); background: var(--ctrl-fill-secondary); touch-action: none; cursor: grab; }
.avatar-uploader__preview:active { cursor: grabbing; }
.avatar-uploader__controls { display: grid; gap: 0.5rem; }
.avatar-uploader__controls label { display: grid; grid-template-columns: 5.5rem 1fr; align-items: center; gap: 0.5rem; font-size: 0.85rem; }
.avatar-uploader__controls input { width: 100%; }
.avatar-uploader__actions { justify-content: flex-end; }
</style>
