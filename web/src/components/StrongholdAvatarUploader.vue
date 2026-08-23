<script setup lang="ts">
import { ref } from 'vue'
import { api, ApiRequestError } from '../api'
import { useStorageUsage } from '../composables/useStorageUsage'
import { fileUploadError } from '../utils/validate'
import { WinButton } from '../vendor/winui'
import ImageEditor from './ImageEditor.vue'

const props = defineProps<{ modelValue: string; token: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()
const { usage, noteUploaded } = useStorageUsage()
const fileInput = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const uploading = ref(false)
const error = ref('')

function choose() { fileInput.value?.click() }
function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  selectedFile.value = input.files?.[0] ?? null
  input.value = ''
}

async function upload(blob: Blob) {
  const preflight = fileUploadError(blob, usage.value)
  if (preflight) { error.value = preflight; return }
  uploading.value = true
  error.value = ''
  try {
    const result = await api.uploadMedia(props.token, blob)
    noteUploaded(result.size)
    emit('update:modelValue', result.url)
    selectedFile.value = null
  } catch (err) {
    const messages: Record<string, string> = { FILE_TOO_LARGE: '文件超过实例大小限制', QUOTA_EXCEEDED: '你的存储配额已用尽', MIME_REJECTED: '不支持的文件类型' }
    error.value = err instanceof ApiRequestError ? (messages[err.code] ?? '上传失败，请稍后重试') : '上传失败，请稍后重试'
  } finally { uploading.value = false }
}
</script>

<template>
  <div class="avatar-uploader">
    <div class="avatar-uploader__row">
      <img v-if="modelValue" class="avatar-uploader__current" :src="modelValue" alt="当前据点头像" />
      <span v-else class="avatar-uploader__placeholder" aria-hidden="true">头像</span>
      <input ref="fileInput" class="avatar-uploader__file-input" type="file" accept="image/*" @change="onFileChange" />
      <WinButton Style="DefaultButtonStyle" :IsEnabled="!uploading" @click="choose">选择图片</WinButton>
      <WinButton v-if="modelValue" Style="SubtleButtonStyle" :IsEnabled="!uploading" @click="emit('update:modelValue', '')">移除</WinButton>
    </div>
    <p v-if="error" class="field__error" role="alert">{{ error }}</p>
    <ImageEditor :file="selectedFile" square :output-size="512" @confirm="upload" @cancel="selectedFile = null" />
  </div>
</template>

<style scoped>
.avatar-uploader__row { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
.avatar-uploader__current,.avatar-uploader__placeholder { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; border: 1px solid var(--card-stroke); }
.avatar-uploader__placeholder { display: grid; place-items: center; font-size: .75rem; color: var(--text-secondary); background: var(--ctrl-fill-secondary); }
.avatar-uploader__file-input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
