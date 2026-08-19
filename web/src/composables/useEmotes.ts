import { ref, watch } from 'vue'
import { api } from '../api'
import type { EmotePack } from '../api/types'
import { useAuth } from './useAuth'

const packs = ref<EmotePack[]>([])
const loading = ref(false)
let loaded = false

async function loadEmotes() {
  const auth = useAuth()
  if (!auth.token.value || loading.value) return
  loading.value = true
  try {
    packs.value = await api.getEmotes(auth.token.value)
    loaded = true
  } catch {
    // non-fatal - picker just shows empty, :pack:name: codes render as plain text
  } finally {
    loading.value = false
  }
}

export function useEmotes() {
  const auth = useAuth()
  watch(
    auth.isAuthenticated,
    (authenticated) => {
      if (authenticated && !loaded) void loadEmotes()
      else if (!authenticated) {
        packs.value = []
        loaded = false
      }
    },
    { immediate: true },
  )
  return { packs, loading }
}
