<script setup lang="ts">
import LeftColumn from './components/LeftColumn.vue'
import MiddleColumn from './components/MiddleColumn.vue'
import MobileNavBar from './components/MobileNavBar.vue'
import NodeRail from './components/NodeRail.vue'
import PostModal from './components/PostModal.vue'
import RightColumn from './components/RightColumn.vue'
import TopBar from './components/TopBar.vue'
import { useShellView } from './composables/useShellView'

const { activeView } = useShellView()
</script>

<template>
  <div class="shell">
    <TopBar />
    <div class="shell__body" :data-view="activeView">
      <NodeRail />
      <LeftColumn />
      <MiddleColumn />
      <RightColumn />
    </div>
    <MobileNavBar />
    <PostModal />
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
