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
  background: rgb(var(--colors-background-regular));
  border-left: 1px solid rgb(var(--colors-background-gray));
  overflow-y: auto;
}

.right-column__card {
  height: 120px;
  border-radius: var(--radius-md);
  background: rgb(var(--colors-background-lighter));
}
</style>
