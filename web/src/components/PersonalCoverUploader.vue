<script setup lang="ts">
import { ref } from 'vue'
import { api, ApiRequestError } from '../api'
import { useStorageUsage } from '../composables/useStorageUsage'
import { fileUploadError } from '../utils/validate'
import { WinButton } from '../vendor/winui'
import ImageEditor from './ImageEditor.vue'

const props = defineProps<{ modelValue: string | null; token: string }>()
const emit = defineEmits<{ 'update:modelValue': [string | null] }>()
const { usage, noteUploaded } = useStorageUsage()
const fileInput = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const busy = ref(false)
const error = ref('')

function choose() { fileInput.value?.click() }
function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  selectedFile.value = input.files?.[0] ?? null
  input.value = ''
}
function errorMessage(err: unknown): string {
  if (!(err instanceof ApiRequestError)) return '封面更新失败，请稍后重试'
  const messages: Record<string, string> = {
    FILE_TOO_LARGE: '文件超过实例大小限制', QUOTA_EXCEEDED: '你的存储配额已用尽', MIME_REJECTED: '不支持的图片格式',
    COVER_IMAGE_REQUIRED: '封面仅支持 PNG、JPEG、WebP 或 GIF', IMAGE_PROCESSING_FAILED: '无法安全处理这张图片',
  }
  return messages[err.code] ?? '封面更新失败，请稍后重试'
}
async function upload(blob: Blob) {
  const preflight = fileUploadError(blob, usage.value)
  if (preflight) { error.value = preflight; return }
  busy.value = true; error.value = ''
  try { const result = await api.uploadCover(props.token, blob); noteUploaded(result.size); emit('update:modelValue', result.cover); selectedFile.value = null }
  catch (err) { error.value = errorMessage(err) }
  finally { busy.value = false }
}
async function clear() {
  busy.value = true; error.value = ''
  try { await api.clearCover(props.token); emit('update:modelValue', null) }
  catch (err) { error.value = errorMessage(err) }
  finally { busy.value = false }
}
</script>

<template>
  <div class="personal-cover-uploader">
    <div class="personal-cover-uploader__preview">
      <img v-if="modelValue" :src="modelValue" alt="个人封面预览" />
      <span v-else>尚未设置个人封面</span>
    </div>
    <div class="personal-cover-uploader__actions">
      <input ref="fileInput" class="personal-cover-uploader__file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="onFileChange" />
      <WinButton Style="DefaultButtonStyle" :IsEnabled="!busy" @click="choose">选择封面</WinButton>
      <WinButton v-if="modelValue" Style="SubtleButtonStyle" :IsEnabled="!busy" @click="clear">清除封面</WinButton>
    </div>
    <p class="personal-cover-uploader__hint">上传前可按宽屏比例裁剪；建议使用 3:1 横幅图片。</p>
    <p v-if="error" class="field__error" role="alert">{{ error }}</p>
    <ImageEditor :file="selectedFile" crop-label="封面 3:1" :crop-ratio="3" :output-size="1200" :uploading="busy" @confirm="upload" @cancel="selectedFile = null" />
  </div>
</template>

<style scoped>
.personal-cover-uploader { display: flex; flex-direction: column; gap: .45rem; }
.personal-cover-uploader__preview { width: 100%; aspect-ratio: 3 / 1; overflow: hidden; border-radius: var(--radius-sm); background: var(--ctrl-fill-secondary); display: grid; place-items: center; color: var(--text-tertiary); font-size: .8rem; }
.personal-cover-uploader__preview img { width: 100%; height: 100%; object-fit: cover; }
.personal-cover-uploader__actions { display: flex; flex-wrap: wrap; gap: .45rem; }
.personal-cover-uploader__file-input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.personal-cover-uploader__hint { margin: 0; font-size: .78rem; line-height: 1.45; color: var(--text-secondary); }
</style>
