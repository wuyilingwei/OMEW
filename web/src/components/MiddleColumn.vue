<script setup lang="ts">
import ChatPane from './ChatPane.vue'
import TopicTagBar from './TopicTagBar.vue'
</script>

<template>
  <main class="middle-column">
    <TopicTagBar />
    <ChatPane />
  </main>
</template>

<style scoped>
.middle-column {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: rgb(var(--colors-background-regular));
}
</style>
