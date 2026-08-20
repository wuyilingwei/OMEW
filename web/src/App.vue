<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AuthGate from './components/AuthGate.vue'
import AuthModal from './components/AuthModal.vue'
import ColumnResizer from './components/ColumnResizer.vue'
import LeftColumn from './components/LeftColumn.vue'
import MiddleColumn from './components/MiddleColumn.vue'
import MobileNavBar from './components/MobileNavBar.vue'
import NodeRail from './components/NodeRail.vue'
import PostModal from './components/PostModal.vue'
import RightColumn from './components/RightColumn.vue'
import ServerAdminPanel from './components/ServerAdminPanel.vue'
import StrongholdOnboarding from './components/StrongholdOnboarding.vue'
import StrongholdPanel from './components/StrongholdPanel.vue'
import { useAuth } from './composables/useAuth'
import { LEFT_WIDTH_DEFAULT, LEFT_WIDTH_KEY, RIGHT_WIDTH_DEFAULT, RIGHT_WIDTH_KEY } from './composables/useColumnResize'
import { useDocumentTitle } from './composables/useDocumentTitle'
import { useInstanceConfig } from './composables/useInstanceConfig'
import { useShellView } from './composables/useShellView'
import { useStronghold } from './composables/useStronghold'

const auth = useAuth()
// 'server-admin' (ServerAdminPanel) and 'stronghold-panel' (StrongholdPanel)
// are two independent full-screen overlays with separate entry points (task
// 039 split) - never share navigation state beyond this top-level view key.
const view = ref<'app' | 'server-admin' | 'stronghold-panel'>('app')
const strongholdPanelTab = ref<'members' | 'groups' | 'settings'>('members')
const { activeView } = useShellView()
const { config: instanceConfig } = useInstanceConfig()
const { nodes, loading: strongholdsLoading } = useStronghold()
const hasStrongholds = computed(() => nodes.value.length > 0)
useDocumentTitle()

// an unauthenticated visitor only hits the full-screen gate when the
// instance doesn't allow guest browsing (or its config hasn't loaded
// yet, same fallback as before) - otherwise the four-column shell renders
// directly in its read-only guest state (useStronghold's isGuestMode).
const showAuthGate = computed(() => !auth.isAuthenticated.value && !instanceConfig.value?.allow_guest_browsing)

function openStrongholdPanel(tab: 'members' | 'groups' | 'settings') {
  strongholdPanelTab.value = tab
  view.value = 'stronghold-panel'
}

watch(auth.isAuthenticated, (authenticated) => {
  if (!authenticated) view.value = 'app'
})
</script>

<template>
  <div class="shell">
    <AuthGate v-if="showAuthGate" />

    <div v-else-if="auth.isAuthenticated.value && strongholdsLoading && !hasStrongholds" class="shell__loading">
      正在加载据点…
    </div>

    <StrongholdOnboarding v-else-if="auth.isAuthenticated.value && !hasStrongholds" />

    <ServerAdminPanel v-else-if="view === 'server-admin'" @close="view = 'app'" />

    <StrongholdPanel
      v-else-if="view === 'stronghold-panel'"
      :initial-tab="strongholdPanelTab"
      @close="view = 'app'"
    />

    <template v-else>
      <div class="shell__body" :data-view="activeView">
        <NodeRail />
        <LeftColumn />
        <ColumnResizer :var-name="'--left-width'" :storage-key="LEFT_WIDTH_KEY" :default-percent="LEFT_WIDTH_DEFAULT" />
        <MiddleColumn />
        <ColumnResizer
          :var-name="'--right-width'"
          :storage-key="RIGHT_WIDTH_KEY"
          :default-percent="RIGHT_WIDTH_DEFAULT"
          invert
        />
        <RightColumn @open-server-admin="view = 'server-admin'" @open-panel="openStrongholdPanel" />
      </div>
      <MobileNavBar />
      <PostModal />
      <AuthModal />
    </template>
  </div>
</template>

<style scoped>
.shell {
  position: relative;
  height: 100%;
}

.shell__body {
  display: flex;
  flex-direction: row;
  height: 100%;
}

.shell__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
  font-size: 0.85rem;
}

@media (max-width: 768px) {
  .shell__body {
    flex-direction: column;
    padding-bottom: calc(var(--navbar-height) + env(safe-area-inset-bottom));
  }
}
</style>
