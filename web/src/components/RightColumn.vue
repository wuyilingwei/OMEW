<script setup lang="ts">
import { computed } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useStronghold } from '../composables/useStronghold'
import { useStrongholdConfig } from '../composables/useStrongholdConfig'
import { useStrongholdMembers } from '../composables/useStrongholdMembers'
import { useTheme } from '../composables/useTheme'
import { WinButton, WinDropDownButton } from '../vendor/winui'
import AvatarBadge from './AvatarBadge.vue'

const emit = defineEmits<{ 'open-admin-settings': []; 'open-panel': ['members' | 'settings'] }>()

const { mode, cycleTheme } = useTheme()
const auth = useAuth()
const { currentNode } = useStronghold()
const { config } = useStrongholdConfig()
const { myRole } = useStrongholdMembers()

const strongholdName = computed(() => config.value?.name ?? currentNode.value?.name ?? '')
const strongholdDescription = computed(() => config.value?.description ?? '')
const strongholdCover = computed(() => config.value?.cover || currentNode.value?.cover || '')

const modeLabel: Record<string, string> = {
  system: '跟随系统',
  light: '亮色',
  dark: '暗色',
}

const canManage = computed(() => myRole.value === 'owner' || myRole.value === 'mod')

const userMenu = computed(() => ({
  Items: [
    ...(auth.isAdmin.value ? [{ Text: '节点设置', Value: 'settings' }] : []),
    { Text: '登出', Value: 'logout' },
  ],
}))

function onUserMenuSelect(item: { Value: string }) {
  if (item.Value === 'settings') emit('open-admin-settings')
  else if (item.Value === 'logout') auth.logout()
}
</script>

<template>
  <aside class="right-column">
    <div class="right-column__topbar">
      <WinButton Style="SubtleButtonStyle" class="right-column__theme-btn" @Click="cycleTheme">
        主题：{{ modeLabel[mode] }}
      </WinButton>
      <WinDropDownButton v-if="auth.isAuthenticated.value" :Flyout="userMenu" @Select="onUserMenuSelect">
        <span class="right-column__user">
          <AvatarBadge :seed="auth.user.value?.username ?? ''" :size="24" />
          <span class="right-column__username">{{ auth.user.value?.username }}</span>
        </span>
      </WinDropDownButton>
    </div>

    <div class="right-column__stronghold">
      <img v-if="strongholdCover" class="right-column__cover" :src="strongholdCover" :alt="strongholdName" />
      <div class="right-column__stronghold-body">
        <h2 class="right-column__stronghold-name">{{ strongholdName }}</h2>
        <p class="right-column__stronghold-description">{{ strongholdDescription }}</p>
      </div>
    </div>

    <div class="right-column__actions">
      <WinButton Style="DefaultButtonStyle" class="right-column__action" @Click="emit('open-panel', 'members')">
        成员列表
      </WinButton>
      <WinButton
        v-if="canManage"
        Style="DefaultButtonStyle"
        class="right-column__action"
        @Click="emit('open-panel', 'settings')"
      >
        据点设置
      </WinButton>
    </div>
  </aside>
</template>

<style scoped>
.right-column {
  flex: 0 0 var(--right-width);
  width: var(--right-width);
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  background: var(--app-bg);
  border-left: 1px solid var(--stroke-divider);
  overflow-y: auto;
}

.right-column__topbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.right-column__theme-btn {
  font-size: 0.8rem;
}

.right-column__user {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.right-column__username {
  font-size: 0.85rem;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.right-column__stronghold {
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  overflow: hidden;
}

.right-column__cover {
  width: 100%;
  height: 96px;
  object-fit: cover;
}

.right-column__stronghold-body {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.75rem 0.85rem;
}

.right-column__stronghold-name {
  margin: 0;
  font-size: 0.98rem;
  font-weight: 600;
  color: var(--text-primary);
}

.right-column__stronghold-description {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.5;
  color: var(--text-secondary);
}

.right-column__actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.right-column__action {
  width: 100%;
  justify-content: center;
}

@media (max-width: 768px) {
  .right-column {
    display: none;
  }

  .shell__body[data-view='stronghold'] .right-column {
    display: flex;
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    border-left: none;
  }
}
</style>
