import { ref, watchEffect } from 'vue'

export type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'openmew-theme'

const stored = localStorage.getItem(STORAGE_KEY)
const mode = ref<ThemeMode>(stored === 'light' || stored === 'dark' ? stored : 'system')

watchEffect(() => {
  const root = document.documentElement
  if (mode.value === 'system') {
    root.removeAttribute('data-theme')
    // let vendored theme.css fall back to its own prefers-color-scheme block
    root.classList.remove('theme-light', 'theme-dark')
  } else {
    root.setAttribute('data-theme', mode.value)
    // vendored theme.css keys its explicit light/dark override off these
    // classes, not [data-theme] — drive both so an explicit choice here
    // wins over the OS preference in both token systems
    root.classList.toggle('theme-light', mode.value === 'light')
    root.classList.toggle('theme-dark', mode.value === 'dark')
  }
  localStorage.setItem(STORAGE_KEY, mode.value)
})

function cycleTheme() {
  mode.value = mode.value === 'system' ? 'light' : mode.value === 'light' ? 'dark' : 'system'
}

function setMode(next: ThemeMode) {
  mode.value = next
}

export function useTheme() {
  return { mode, cycleTheme, setMode }
}
