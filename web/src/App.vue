<script setup lang="ts">
import { ref, watch } from 'vue'
import AdminSettings from './components/AdminSettings.vue'
import AuthGate from './components/AuthGate.vue'
import LeftColumn from './components/LeftColumn.vue'
import MiddleColumn from './components/MiddleColumn.vue'
import MobileNavBar from './components/MobileNavBar.vue'
import NodeRail from './components/NodeRail.vue'
import PostModal from './components/PostModal.vue'
import RightColumn from './components/RightColumn.vue'
import TopBar from './components/TopBar.vue'
import { useAuth } from './composables/useAuth'
import { useShellView } from './composables/useShellView'

const auth = useAuth()
const view = ref<'app' | 'admin'>('app')
const { activeView } = useShellView()

watch(auth.isAuthenticated, (authenticated) => {
  if (!authenticated) view.value = 'app'
})
</script>

<template>
  <div class="shell">
    <TopBar @open-settings="view = 'admin'" />

    <AuthGate v-if="!auth.isAuthenticated.value" />

    <AdminSettings v-else-if="view === 'admin'" @close="view = 'app'" />

    <template v-else>
      <div class="shell__body" :data-view="activeView">
        <NodeRail />
        <LeftColumn />
        <MiddleColumn />
        <RightColumn />
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
  padding-top: var(--topbar-height);
}

@media (max-width: 768px) {
  .shell__body {
    flex-direction: column;
    padding-bottom: calc(var(--navbar-height) + env(safe-area-inset-bottom));
  }
}
</style>
