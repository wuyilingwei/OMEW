import { ref, watchEffect } from 'vue'

export type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'openmew-theme'

const stored = localStorage.getItem(STORAGE_KEY)
const mode = ref<ThemeMode>(stored === 'light' || stored === 'dark' ? stored : 'system')

watchEffect(() => {
  if (mode.value === 'system') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', mode.value)
  }
  localStorage.setItem(STORAGE_KEY, mode.value)
})

function cycleTheme() {
  mode.value = mode.value === 'system' ? 'light' : mode.value === 'light' ? 'dark' : 'system'
}

export function useTheme() {
  return { mode, cycleTheme }
}
