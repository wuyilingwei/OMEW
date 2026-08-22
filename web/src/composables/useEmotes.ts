import { computed, ref, watch } from 'vue'
import { api } from '../api'
import type { EmotePack } from '../api/types'
import { BUILTIN_REACTION_PACK } from '../assets/mew-emotes'
import { useAuth } from './useAuth'

const instancePacks = ref<EmotePack[]>([])
const loading = ref(false)
let loaded = false

async function loadEmotes() {
  const auth = useAuth()
  if (!auth.token.value || loading.value) return
  loading.value = true
  try {
    instancePacks.value = await api.getEmotes(auth.token.value)
    loaded = true
  } catch {
    // non-fatal - picker just falls back to the built-in pack, :pack:name: codes render as plain text
  } finally {
    loading.value = false
  }
}

// built-in packs always present and listed last, so they win on a same-name
// collision against the emote lookup (buildEmoteLookup keeps the last entry
// written for a given "pack:name" key).
const packs = computed<EmotePack[]>(() => [...instancePacks.value, BUILTIN_REACTION_PACK])

export function useEmotes() {
  const auth = useAuth()
  watch(
    auth.isAuthenticated,
    (authenticated) => {
      if (authenticated && !loaded) void loadEmotes()
      else if (!authenticated) {
        instancePacks.value = []
        loaded = false
      }
    },
    { immediate: true },
  )
  return { packs, loading }
}
