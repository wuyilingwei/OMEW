<script setup lang="ts">
import LeftColumn from './components/LeftColumn.vue'
import MiddleColumn from './components/MiddleColumn.vue'
import NodeRail from './components/NodeRail.vue'
import RightColumn from './components/RightColumn.vue'
import TopBar from './components/TopBar.vue'
</script>

<template>
  <div class="shell">
    <TopBar />
    <div class="shell__body">
      <NodeRail />
      <LeftColumn />
      <MiddleColumn />
      <RightColumn />
    </div>
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
