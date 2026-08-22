<script setup lang="ts">
import { computed, ref } from 'vue'
import { api, ApiRequestError } from '../api'
import { useStorageUsage } from '../composables/useStorageUsage'
import { fileUploadError } from '../utils/validate'
import { processImage, type ImageOutputMode } from '../utils/imageProcessing'
import { WinButton, WinToggleSwitch } from '../vendor/winui'

const props = defineProps<{ modelValue: string; token: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  FILE_TOO_LARGE: '文件超过实例大小限制',
  QUOTA_EXCEEDED: '你的存储配额已用尽',
  MIME_REJECTED: '不支持的文件类型',
}

const { usage, noteUploaded } = useStorageUsage()

const uploading = ref(false)
const progress = ref(0)
const error = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const mode = ref<ImageOutputMode>('webp')
const keepOriginal = computed({ get: () => mode.value === 'original', set: (value: boolean) => { mode.value = value ? 'original' : 'webp' } })

function pickFile() {
  fileInput.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  error.value = ''
  let processed
  try {
    processed = await processImage(file, { mode: mode.value })
  } catch {
    error.value = '无法处理这张图片'
    input.value = ''
    return
  }
  const preflight = fileUploadError(processed.blob, usage.value)
  if (preflight) {
    error.value = preflight
    input.value = ''
    return
  }
  uploading.value = true
  progress.value = 0
  try {
    const result = await api.uploadMedia(props.token, processed.blob, (pct) => {
      progress.value = pct
    })
    noteUploaded(result.size)
    emit('update:modelValue', result.url)
    if (processed.isGif) error.value = 'GIF 为保留动画不压缩，已按原图上传'
    else if (processed.webpFallback) error.value = '此浏览器不能编码 WebP，已改用 PNG 上传'
  } catch (err) {
    error.value = err instanceof ApiRequestError ? (UPLOAD_ERROR_MESSAGES[err.code] ?? '上传失败，请稍后重试') : '上传失败，请稍后重试'
  } finally {
    uploading.value = false
    input.value = ''
  }
}
</script>

<template>
  <div class="cover-uploader">
    <div class="cover-uploader__row">
      <img v-if="modelValue" class="cover-uploader__preview" :src="modelValue" alt="" />
      <div class="cover-uploader__actions">
        <input ref="fileInput" class="cover-uploader__file-input" type="file" accept="image/*" @change="onFileChange" />
        <WinButton Style="DefaultButtonStyle" :IsEnabled="!uploading" @click="pickFile">
          {{ uploading ? `上传中…${progress}%` : '上传文件' }}
        </WinButton>
        <WinToggleSwitch v-model="keepOriginal" :IsEnabled="!uploading" OnContent="保留原图" OffContent="默认压缩为 WebP" />
      </div>
    </div>
    <p v-if="error" class="field__error">{{ error }}</p>
  </div>
</template>

<style scoped>
.cover-uploader {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.cover-uploader__row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.cover-uploader__preview {
  width: 64px;
  height: 40px;
  border-radius: var(--radius-xs);
  object-fit: cover;
  flex: 0 0 auto;
  border: 1px solid var(--card-stroke);
}

.cover-uploader__actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.cover-uploader__file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}


</style>
