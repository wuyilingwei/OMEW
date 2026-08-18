<script setup lang="ts">
import { mockNodes } from '../data/mock'
</script>

<template>
  <nav class="node-rail">
    <div class="node-rail__logo">OM</div>
    <ul class="node-rail__list">
      <li v-for="node in mockNodes" :key="node.id">
        <button
          class="node-rail__item"
          :class="{ 'node-rail__item--active': node.active }"
          type="button"
          :title="node.name"
        >
          {{ node.iconLabel }}
        </button>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.node-rail {
  flex: 0 0 var(--rail-width);
  width: var(--rail-width);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0;
  background: rgb(var(--colors-background-darker));
  overflow-y: auto;
}

.node-rail__logo {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  background: rgb(var(--colors-primary));
  color: rgb(var(--colors-gray-900));
  margin-bottom: 0.5rem;
}

.node-rail__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
  align-items: center;
}

.node-rail__item {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 2px solid transparent;
  background: rgb(var(--colors-background-lighter));
  color: rgb(var(--colors-body));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
}

.node-rail__item:hover {
  background: rgb(var(--colors-background-hover));
}

.node-rail__item--active {
  border-color: rgb(var(--colors-primary));
  color: rgb(var(--colors-receive-msg));
}
</style>
