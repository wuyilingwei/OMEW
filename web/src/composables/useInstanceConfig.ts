import { ref } from 'vue'
import { api } from '../api'
import type { InstanceConfig } from '../api/types'

// shared singleton: the instance-wide policy config (allow_root,
// allow_guest_browsing, ...) is read by AuthForm, App.vue's guest-shell
// routing, and useStronghold's guest/member data-source switch - one fetch
// per session covers all of them instead of each caller re-requesting it.
const config = ref<InstanceConfig | null>(null)
const loading = ref(false)
const error = ref('')
let loaded = false
let inflight: Promise<void> | null = null

async function load(force = false): Promise<void> {
  if (loaded && !force) return
  if (inflight) return inflight
  loading.value = true
  error.value = ''
  inflight = (async () => {
    try {
      config.value = await api.getInstanceConfig()
      loaded = true
    } catch {
      error.value = '无法获取节点配置，请稍后重试'
    } finally {
      loading.value = false
      inflight = null
    }
  })()
  return inflight
}

export function useInstanceConfig() {
  if (!loaded && !inflight) void load()
  return { config, loading, error, reload: () => load(true) }
}
