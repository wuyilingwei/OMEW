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
import ServerAdminModal from './components/ServerAdminModal.vue'
import StrongholdAdminModal from './components/StrongholdAdminModal.vue'
import StrongholdOnboarding from './components/StrongholdOnboarding.vue'
import { useAuth } from './composables/useAuth'
import { LEFT_WIDTH_DEFAULT, LEFT_WIDTH_KEY, RIGHT_WIDTH_DEFAULT, RIGHT_WIDTH_KEY } from './composables/useColumnResize'
import { useDocumentTitle } from './composables/useDocumentTitle'
import { useInstanceConfig } from './composables/useInstanceConfig'
import { useShellView } from './composables/useShellView'
import { useStronghold } from './composables/useStronghold'

const auth = useAuth()
// ServerAdminModal and StrongholdAdminModal are two independent
// PostModal-style floating overlays with separate entry points (task 039
// split, task 048 modal-ized) - the shell underneath keeps rendering while
// either is open, they never share state beyond these two booleans.
const serverAdminOpen = ref(false)
const strongholdAdminOpen = ref(false)
const strongholdAdminTab = ref<'members' | 'settings'>('members')
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

function openStrongholdAdmin(tab: 'members' | 'settings') {
  strongholdAdminTab.value = tab
  strongholdAdminOpen.value = true
}

watch(auth.isAuthenticated, (authenticated) => {
  if (!authenticated) {
    serverAdminOpen.value = false
    strongholdAdminOpen.value = false
  }
})
</script>

<template>
  <div class="shell">
    <AuthGate v-if="showAuthGate" />

    <div v-else-if="auth.isAuthenticated.value && strongholdsLoading && !hasStrongholds" class="shell__loading">
      正在加载据点…
    </div>

    <StrongholdOnboarding v-else-if="auth.isAuthenticated.value && !hasStrongholds" />

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
        <RightColumn @open-server-admin="serverAdminOpen = true" @open-panel="openStrongholdAdmin" />
      </div>
      <MobileNavBar />
      <PostModal />
      <AuthModal />
    </template>

    <ServerAdminModal :open="serverAdminOpen" @close="serverAdminOpen = false" />
    <StrongholdAdminModal :open="strongholdAdminOpen" :initial-tab="strongholdAdminTab" @close="strongholdAdminOpen = false" />
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
