<script setup lang="ts">
import { computed } from 'vue'
import { useEmotes } from '../composables/useEmotes'

const emit = defineEmits<{ pick: [code: string]; close: [] }>()
const { packs, loading } = useEmotes()

// built-in pack always shows first regardless of load order, instance-defined
// packs follow in whatever order the API returned them.
const groups = computed(() => {
  const builtin = packs.value.filter((pack) => pack.id === 'builtin-mew')
  const custom = packs.value.filter((pack) => pack.id !== 'builtin-mew')
  return [...builtin, ...custom].filter((pack) => pack.emotes.length > 0)
})
const isEmpty = computed(() => !loading.value && groups.value.length === 0)
</script>

<template>
  <div class="emote-picker-overlay" @click.self="emit('close')">
    <div class="emote-picker" role="dialog" aria-label="表情选择器">
      <div v-if="loading && !groups.length" class="emote-picker__notice">加载中…</div>
      <p v-else-if="isEmpty" class="emote-picker__notice">暂无表情包</p>
      <div v-else class="emote-picker__groups">
        <section v-for="pack in groups" :key="pack.id" class="emote-picker__group">
          <h3 class="emote-picker__group-title">{{ pack.display ?? pack.name }}</h3>
          <div class="emote-picker__grid">
            <button
              v-for="emote in pack.emotes"
              :key="`${pack.name}:${emote.name}`"
              type="button"
              class="emote-picker__item"
              :title="`:${pack.name}:${emote.name}:`"
              @click="emit('pick', `:${pack.name}:${emote.name}:`)"
            >
              <img :src="emote.url" :alt="emote.name" loading="lazy" />
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.emote-picker-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
}

.emote-picker {
  position: absolute;
  bottom: calc(100% + 0.5rem);
  left: 1rem;
  width: min(360px, calc(100% - 2rem));
  max-height: 320px;
  overflow-y: auto;
  padding: 0.6rem;
  border-radius: var(--radius-md);
  background: var(--flyout-bg, var(--layer-default));
  border: 1px solid var(--card-stroke);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.24);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
}

.emote-picker__notice {
  margin: 0;
  padding: 1.5rem 0.5rem;
  text-align: center;
  font-size: 0.82rem;
  color: var(--text-tertiary);
}

.emote-picker__groups {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.emote-picker__group-title {
  margin: 0 0 0.35rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-tertiary);
}

.emote-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, 80px);
  gap: 0.4rem;
  justify-content: center;
}

.emote-picker__item {
  width: 80px;
  height: 80px;
  padding: 0.4rem;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--ctrl-fill-secondary);
  transition: background var(--fast-duration) var(--fast-out-slow-in);
}

.emote-picker__item:hover {
  background: var(--ctrl-fill-tertiary);
}

.emote-picker__item img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
