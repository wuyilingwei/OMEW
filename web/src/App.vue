<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AdminSettings from './components/AdminSettings.vue'
import AuthGate from './components/AuthGate.vue'
import ColumnResizer from './components/ColumnResizer.vue'
import LeftColumn from './components/LeftColumn.vue'
import MiddleColumn from './components/MiddleColumn.vue'
import MobileNavBar from './components/MobileNavBar.vue'
import NodeRail from './components/NodeRail.vue'
import PostModal from './components/PostModal.vue'
import RightColumn from './components/RightColumn.vue'
import StrongholdOnboarding from './components/StrongholdOnboarding.vue'
import StrongholdPanel from './components/StrongholdPanel.vue'
import { useAuth } from './composables/useAuth'
import { LEFT_WIDTH_DEFAULT, LEFT_WIDTH_KEY, RIGHT_WIDTH_DEFAULT, RIGHT_WIDTH_KEY } from './composables/useColumnResize'
import { useShellView } from './composables/useShellView'
import { useStronghold } from './composables/useStronghold'

const auth = useAuth()
const view = ref<'app' | 'admin' | 'stronghold-panel'>('app')
const strongholdPanelTab = ref<'members' | 'settings'>('members')
const { activeView } = useShellView()
const { nodes, loading: strongholdsLoading } = useStronghold()
const hasStrongholds = computed(() => nodes.value.length > 0)

function openStrongholdPanel(tab: 'members' | 'settings') {
  strongholdPanelTab.value = tab
  view.value = 'stronghold-panel'
}

watch(auth.isAuthenticated, (authenticated) => {
  if (!authenticated) view.value = 'app'
})
</script>

<template>
  <div class="shell">
    <AuthGate v-if="!auth.isAuthenticated.value" />

    <div v-else-if="strongholdsLoading && !hasStrongholds" class="shell__loading">正在加载据点…</div>

    <StrongholdOnboarding v-else-if="!hasStrongholds" />

    <AdminSettings v-else-if="view === 'admin'" @close="view = 'app'" />

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
        <RightColumn @open-admin-settings="view = 'admin'" @open-panel="openStrongholdPanel" />
      </div>
      <MobileNavBar />
      <PostModal />
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
