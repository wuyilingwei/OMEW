<script setup lang="ts">
import { useShellView } from '../composables/useShellView'
import type { ShellView } from '../composables/useShellView'

const { activeView, setView } = useShellView()

const tabs: { view: ShellView; label: string }[] = [
  { view: 'posts', label: '帖子' },
  { view: 'chat', label: '聊天' },
  { view: 'stronghold', label: '据点' },
]
</script>

<template>
  <nav class="mobile-nav">
    <button
      v-for="tab in tabs"
      :key="tab.view"
      type="button"
      class="mobile-nav__item"
      :class="{ 'mobile-nav__item--active': tab.view === activeView }"
      @click="setView(tab.view)"
    >
      <svg v-if="tab.view === 'posts'" class="mobile-nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1="7" y1="9" x2="17" y2="9" />
        <line x1="7" y1="13" x2="17" y2="13" />
        <line x1="7" y1="17" x2="12" y2="17" />
      </svg>
      <svg v-else-if="tab.view === 'chat'" class="mobile-nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
      <svg v-else class="mobile-nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 21V10l9-7 9 7v11" />
        <path d="M9 21v-7h6v7" />
      </svg>
      <span class="mobile-nav__label">{{ tab.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.mobile-nav {
  display: none;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  /* border-box: 总高需含 safe-area,否则 padding 会压扁按钮区 */
  height: calc(var(--navbar-height) + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--layer-default);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border-top: 1px solid var(--stroke-divider);
}

@media (max-width: 768px) {
  .mobile-nav {
    display: flex;
  }
}

.mobile-nav__item {
  flex: 1 1 0;
  height: var(--navbar-height);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  transition: background var(--fast-duration) var(--fast-out-slow-in), color var(--fast-duration);
}

.mobile-nav__item:active {
  background: var(--ctrl-fill-secondary);
}

.mobile-nav__item--active {
  color: rgb(var(--colors-primary));
  font-weight: 600;
}

.mobile-nav__icon {
  width: 20px;
  height: 20px;
}

.mobile-nav__label {
  font-size: 0.7rem;
}
</style>
