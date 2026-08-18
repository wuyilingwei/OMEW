<script setup lang="ts"></script>

<template>
  <aside class="right-column">
    <div class="right-column__card"></div>
    <div class="right-column__card"></div>
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

.right-column__card {
  height: 120px;
  border-radius: 8px;
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
}
</style>
