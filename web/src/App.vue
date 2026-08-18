<script setup lang="ts">
import { ref, watch } from 'vue'
import AdminSettings from './components/AdminSettings.vue'
import AuthGate from './components/AuthGate.vue'
import LeftColumn from './components/LeftColumn.vue'
import MiddleColumn from './components/MiddleColumn.vue'
import NodeRail from './components/NodeRail.vue'
import PostModal from './components/PostModal.vue'
import RightColumn from './components/RightColumn.vue'
import TopBar from './components/TopBar.vue'
import { useAuth } from './composables/useAuth'

const auth = useAuth()
const view = ref<'app' | 'admin'>('app')

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
      <div class="shell__body">
        <NodeRail />
        <LeftColumn />
        <MiddleColumn />
        <RightColumn />
      </div>
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
</style>
