<script setup lang="ts">
import { ref } from 'vue'
import { api, ApiRequestError } from '../api'
import { useStorageUsage } from '../composables/useStorageUsage'
import { fileUploadError } from '../utils/validate'
import { WinButton } from '../vendor/winui'
import AvatarBadge from './AvatarBadge.vue'
import ImageEditor from './ImageEditor.vue'

const props = defineProps<{ modelValue: string | null; token: string; seed: string }>()
const emit = defineEmits<{ 'update:modelValue': [string | null] }>()
const { usage, noteUploaded } = useStorageUsage()
const fileInput = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const busy = ref(false)
const error = ref('')

function choose() {
  fileInput.value?.click()
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  selectedFile.value = input.files?.[0] ?? null
  input.value = ''
}

function errorMessage(err: unknown): string {
  if (!(err instanceof ApiRequestError)) return '头像更新失败，请稍后重试'
  const messages: Record<string, string> = {
    FILE_TOO_LARGE: '文件超过实例大小限制',
    QUOTA_EXCEEDED: '你的存储配额已用尽',
    MIME_REJECTED: '不支持的图片格式',
    AVATAR_IMAGE_REQUIRED: '头像仅支持 PNG、JPEG、WebP 或 GIF',
    IMAGE_PROCESSING_FAILED: '无法安全处理这张图片',
  }
  return messages[err.code] ?? '头像更新失败，请稍后重试'
}

async function upload(blob: Blob) {
  const preflight = fileUploadError(blob, usage.value)
  if (preflight) {
    error.value = preflight
    return
  }
  busy.value = true
  error.value = ''
  try {
    const result = await api.uploadAvatar(props.token, blob)
    noteUploaded(result.size)
    emit('update:modelValue', result.avatar)
    selectedFile.value = null
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    busy.value = false
  }
}

async function clear() {
  busy.value = true
  error.value = ''
  try {
    await api.clearAvatar(props.token)
    emit('update:modelValue', null)
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="personal-avatar-uploader">
    <div class="personal-avatar-uploader__row">
      <AvatarBadge :seed="seed" :size="64" :avatar-url="modelValue ?? undefined" />
      <div class="personal-avatar-uploader__actions">
        <input
          ref="fileInput"
          class="personal-avatar-uploader__file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          @change="onFileChange"
        />
        <WinButton Style="DefaultButtonStyle" :IsEnabled="!busy" @click="choose">选择图片</WinButton>
        <WinButton v-if="modelValue" Style="SubtleButtonStyle" :IsEnabled="!busy" @click="clear">移除头像</WinButton>
      </div>
    </div>
    <p class="personal-avatar-uploader__hint">上传前可按 1:1 裁剪；静态图默认智能转换，GIF 保留动画。</p>
    <p v-if="error" class="field__error" role="alert">{{ error }}</p>
    <ImageEditor
      :file="selectedFile"
      crop-label="头像 1:1"
      :crop-ratio="1"
      :output-size="512"
      :uploading="busy"
      @confirm="upload"
      @cancel="selectedFile = null"
    />
  </div>
</template>

<style scoped>
.personal-avatar-uploader {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.personal-avatar-uploader__row {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}

.personal-avatar-uploader__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.personal-avatar-uploader__file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.personal-avatar-uploader__hint {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--text-secondary);
}

@media (max-width: 420px) {
  .personal-avatar-uploader__row {
    align-items: flex-start;
  }

  .personal-avatar-uploader__actions {
    flex-direction: column;
  }
}
</style>
