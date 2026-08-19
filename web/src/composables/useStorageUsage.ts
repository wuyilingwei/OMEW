import { ref } from 'vue'
import { api } from '../api'
import type { StorageUsage } from '../api/types'
import { useAuth } from './useAuth'

// shared cache of GET /api/me/storage - every upload entry point (cover
// uploader, chat/post image attachments) pre-checks against this before
// spending a request, instead of each keeping its own copy.
const usage = ref<StorageUsage | null>(null)
let loaded = false

async function refresh() {
  const auth = useAuth()
  if (!auth.token.value) return
  try {
    usage.value = await api.getStorageUsage(auth.token.value)
  } catch {
    usage.value = null
  }
}

export function useStorageUsage() {
  if (!loaded) {
    loaded = true
    void refresh()
  }
  // optimistic local bump right after a successful upload, so the next
  // pre-flight check in the same session sees it without another round trip
  function noteUploaded(bytes: number) {
    if (usage.value) usage.value = { ...usage.value, used: usage.value.used + bytes }
  }
  return { usage, refresh, noteUploaded }
}
