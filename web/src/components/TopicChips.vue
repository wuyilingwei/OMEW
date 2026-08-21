<script setup lang="ts">
import { computed } from 'vue'
import type { Topic } from '../api/types'

// 展示态：只读渲染一组话题 chip（id 匹配不到话题池的直接跳过）
// 可选态：传 selectable 时渲染整套话题池供多选/单选，selected 控制高亮
const props = withDefaults(
  defineProps<{
    topics: Topic[]
    ids?: string[]
    selectable?: boolean
    selected?: string[]
    max?: number
  }>(),
  { ids: () => [], selected: () => [], selectable: false, max: 5 },
)

const emit = defineEmits<{ toggle: [id: string] }>()

const displayTopics = computed<Topic[]>(() =>
  props.selectable ? props.topics : props.ids.map((id) => props.topics.find((t) => t.id === id)).filter((t): t is Topic => !!t),
)

function isSelected(id: string): boolean {
  return props.selected.includes(id)
}

function isDisabled(id: string): boolean {
  return props.selectable && !isSelected(id) && props.selected.length >= props.max
}

function onClick(id: string) {
  if (!props.selectable || isDisabled(id)) return
  emit('toggle', id)
}
</script>

<template>
  <div v-if="displayTopics.length" class="topic-chips">
    <button
      v-for="topic in displayTopics"
      :key="topic.id"
      type="button"
      class="topic-chip"
      :class="{ 'topic-chip--selectable': selectable, 'topic-chip--active': selectable && isSelected(topic.id) }"
      :disabled="isDisabled(topic.id)"
      :title="topic.description || undefined"
      @click="onClick(topic.id)"
    >
      <span v-if="topic.color" class="topic-chip__dot" :style="{ background: topic.color }" />
      <span class="topic-chip__name">{{ topic.name }}</span>
    </button>
  </div>
</template>

<style scoped>
.topic-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.topic-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--ctrl-border);
  background: var(--ctrl-fill-secondary);
  color: var(--text-secondary);
  font-size: 0.72rem;
  line-height: 1.4;
  cursor: default;
}

.topic-chip--selectable {
  cursor: pointer;
}

.topic-chip--selectable:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.topic-chip--active {
  border-color: var(--accent-base);
  color: var(--text-primary);
  background: var(--card-bg-secondary);
}

.topic-chip__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.topic-chip__name {
  white-space: nowrap;
}
</style>
