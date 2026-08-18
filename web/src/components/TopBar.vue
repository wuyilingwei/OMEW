<script setup lang="ts">
import { useTheme } from '../composables/useTheme'
import { WinButton } from '../vendor/winui'

const { mode, cycleTheme } = useTheme()

const modeLabel: Record<string, string> = {
  system: '跟随系统',
  light: '亮色',
  dark: '暗色',
}
</script>

<template>
  <header class="top-bar">
    <span class="top-bar__title">OpenMew</span>
    <WinButton Style="SubtleButtonStyle" class="top-bar__theme-btn" @Click="cycleTheme">
      主题：{{ modeLabel[mode] }}
    </WinButton>
  </header>
</template>

<style scoped>
.top-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  height: var(--topbar-height);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  background: var(--layer-default);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border-bottom: 1px solid var(--stroke-divider);
}

.top-bar__title {
  font-weight: 600;
  color: var(--text-primary);
}

.top-bar__theme-btn {
  position: absolute;
  right: 1rem;
  font-size: 0.85rem;
}
</style>
