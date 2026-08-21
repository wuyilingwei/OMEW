<script setup lang="ts">
import { ref } from 'vue'
import { api, ApiRequestError } from '../api'
import { useStorageUsage } from '../composables/useStorageUsage'
import { fileUploadError } from '../utils/validate'
import { WinButton } from '../vendor/winui'

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

function pickFile() {
  fileInput.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  error.value = ''
  // pre-flight against the cached /api/me/storage usage before spending a request
  const preflight = fileUploadError(file, usage.value)
  if (preflight) {
    error.value = preflight
    input.value = ''
    return
  }
  uploading.value = true
  progress.value = 0
  try {
    const result = await api.uploadMedia(props.token, file, (pct) => {
      progress.value = pct
    })
    noteUploaded(result.size)
    emit('update:modelValue', result.url)
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
        <WinButton Style="DefaultButtonStyle" :IsEnabled="!uploading" @Click="pickFile">
          {{ uploading ? `上传中…${progress}%` : '上传文件' }}
        </WinButton>
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
