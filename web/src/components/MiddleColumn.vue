<script setup lang="ts">
import { useAuth } from '../composables/useAuth'
import { useAuthModal } from '../composables/useAuthModal'
import { useShellView } from '../composables/useShellView'
import { WinButton } from '../vendor/winui'
import ChannelSwitcher from './ChannelSwitcher.vue'
import ChatPane from './ChatPane.vue'

const auth = useAuth()
const { openAuthModal } = useAuthModal()
const { setView } = useShellView()
</script>

<template>
  <main class="middle-column">
    <div class="middle-column__header">
      <button type="button" class="middle-column__back" aria-label="返回据点" @click="setView('stronghold')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <div class="middle-column__header-spacer" />
      <ChannelSwitcher />
    </div>
    <ChatPane v-if="auth.isAuthenticated.value" />
    <!-- guest: no room WS is ever established here, only a login prompt -->
    <div v-else class="middle-column__guest">
      <p class="middle-column__guest-text">登录后参与聊天</p>
      <WinButton Style="AccentButtonStyle" @Click="openAuthModal">登录 / 注册</WinButton>
    </div>
  </main>
</template>

<style scoped>
.middle-column {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--app-bg);
}

.middle-column__header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 1rem;
  background: var(--layer-default);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border-bottom: 1px solid var(--stroke-divider);
}

.middle-column__header-spacer {
  flex: 1 1 auto;
}

.middle-column__back {
  display: none;
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-secondary);
}

.middle-column__back svg {
  width: 20px;
  height: 20px;
}

.middle-column__back:active {
  background: var(--ctrl-fill-secondary);
}

.middle-column__guest {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.9rem;
}

.middle-column__guest-text {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-tertiary);
}

@media (max-width: 768px) {
  .middle-column {
    display: none;
  }

  .shell__body[data-view='chat'] .middle-column {
    display: flex;
    width: 100%;
    min-height: 0;
  }

  .middle-column__back {
    display: flex;
  }
}
</style>
