<script setup lang="ts">
import { mockTopics } from '../data/mock'
</script>

<template>
  <div class="topic-bar">
    <button v-for="topic in mockTopics" :key="topic.id" class="topic-bar__tag" type="button">
      # {{ topic.name }}
    </button>
  </div>
</template>

<style scoped>
.topic-bar {
  flex: 0 0 auto;
  max-height: var(--topic-bar-height);
  overflow: hidden;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  background: rgb(var(--colors-background-regular));
  border-bottom: 1px solid rgb(var(--colors-background-gray));
  transition: max-height 1s linear;
}

.topic-bar:hover {
  max-height: var(--topic-bar-expanded-height);
}

.topic-bar__tag {
  border: none;
  border-radius: 999px;
  padding: 0.3rem 0.8rem;
  margin: 0.15rem 0;
  background: rgb(var(--colors-background-lighter));
  color: rgb(var(--colors-msg));
  font-size: 0.8rem;
  height: fit-content;
}

.topic-bar__tag:hover {
  background: rgb(var(--colors-primary) / 0.15);
  color: rgb(var(--colors-primary));
}
</style>
