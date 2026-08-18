<script setup lang="ts">
import { computed } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useTheme } from '../composables/useTheme'
import { WinButton, WinDropDownButton } from '../vendor/winui'
import AvatarBadge from './AvatarBadge.vue'

const emit = defineEmits<{ 'open-settings': [] }>()

const { mode, cycleTheme } = useTheme()
const auth = useAuth()

const modeLabel: Record<string, string> = {
  system: '跟随系统',
  light: '亮色',
  dark: '暗色',
}

const userMenu = computed(() => ({
  Items: [
    ...(auth.isAdmin.value ? [{ Text: '节点设置', Value: 'settings' }] : []),
    { Text: '登出', Value: 'logout' },
  ],
}))

function onUserMenuSelect(item: { Value: string }) {
  if (item.Value === 'settings') emit('open-settings')
  else if (item.Value === 'logout') auth.logout()
}
</script>

<template>
  <header class="top-bar">
    <span class="top-bar__title">OpenMew</span>
    <div class="top-bar__actions">
      <WinButton Style="SubtleButtonStyle" class="top-bar__theme-btn" @Click="cycleTheme">
        主题：{{ modeLabel[mode] }}
      </WinButton>
      <WinDropDownButton v-if="auth.isAuthenticated.value" :Flyout="userMenu" @Select="onUserMenuSelect">
        <span class="top-bar__user">
          <AvatarBadge :seed="auth.user.value?.username ?? ''" :size="24" />
          <span class="top-bar__username">{{ auth.user.value?.username }}</span>
        </span>
      </WinDropDownButton>
    </div>
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

.top-bar__actions {
  position: absolute;
  right: 1rem;
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.top-bar__theme-btn {
  font-size: 0.85rem;
}

.top-bar__user {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.top-bar__username {
  font-size: 0.85rem;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 768px) {
  /* 居中标题会被右侧动作区压住,窄屏改左对齐 */
  .top-bar {
    justify-content: flex-start;
    padding-left: 1rem;
  }

  .top-bar__username {
    max-width: 72px;
  }
}
</style>
