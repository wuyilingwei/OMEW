<script setup lang="ts">
import { useTheme } from '../composables/useTheme'

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
    <button class="top-bar__theme-btn" type="button" @click="cycleTheme">
      主题：{{ modeLabel[mode] }}
    </button>
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
  background: rgb(var(--colors-background-regular));
  border-bottom: 1px solid rgb(var(--colors-background-gray));
}

.top-bar__title {
  font-weight: 600;
  color: rgb(var(--colors-receive-msg));
}

.top-bar__theme-btn {
  position: absolute;
  right: 1rem;
  border: none;
  border-radius: var(--radius-xs);
  padding: 0.4rem 0.75rem;
  background: rgb(var(--colors-background-receive-msg));
  color: rgb(var(--colors-receive-msg));
  font-size: 0.85rem;
}

.top-bar__theme-btn:hover {
  background: rgb(var(--colors-background-hover));
}
</style>
