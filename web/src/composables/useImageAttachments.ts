import { ref } from 'vue'
import { api, ApiRequestError } from '../api'
import type { MediaAttachment } from '../api/types'
import { fileUploadError } from '../utils/validate'
import { useAuth } from './useAuth'
import { useStorageUsage } from './useStorageUsage'

const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  FILE_TOO_LARGE: '文件超过实例大小限制',
  QUOTA_EXCEEDED: '你的存储配额已用尽',
  MIME_REJECTED: '不支持的文件类型',
}

// per-instance (not shared) attachment staging area for an image-capable
// composer (chat message / post) - picks files (button, paste, or drop),
// pre-checks size/quota client-side before spending a request, uploads via
// the existing /api/media pipeline, and holds the resulting {id,url,mime}
// list until the caller sends and calls reset().
export function useImageAttachments() {
  const auth = useAuth()
  const { usage, noteUploaded } = useStorageUsage()

  const items = ref<MediaAttachment[]>([])
  const uploading = ref(false)
  const error = ref('')

  async function addFiles(files: Iterable<File>) {
    const token = auth.token.value
    if (!token) return
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        error.value = '仅支持图片文件'
        continue
      }
      const preflight = fileUploadError(file, usage.value)
      if (preflight) {
        error.value = preflight
        continue
      }
      error.value = ''
      uploading.value = true
      try {
        const result = await api.uploadMedia(token, file)
        items.value.push({ id: result.id, url: result.url, mime: result.mime })
        noteUploaded(result.size)
      } catch (err) {
        error.value = err instanceof ApiRequestError ? (UPLOAD_ERROR_MESSAGES[err.code] ?? `上传失败：${err.code}`) : '上传失败，请稍后重试'
      } finally {
        uploading.value = false
      }
    }
  }

  function remove(id: string) {
    items.value = items.value.filter((item) => item.id !== id)
  }

  function reset() {
    items.value = []
    error.value = ''
  }

  return { items, uploading, error, addFiles, remove, reset }
}
