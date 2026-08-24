<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '../utils/markdown'

const props = withDefaults(defineProps<{ text?: string }>(), { text: '' })

const rendered = computed(() => renderMarkdown(props.text))
</script>

<template>
  <!-- markdown-it emits escaped HTML because html:false; URLs pass validateLink above. -->
  <div class="markdown-content" v-html="rendered" />
</template>

<style scoped>
.markdown-content {
  color: var(--text-primary);
  font-size: 0.9rem;
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.markdown-content:empty::before {
  content: '暂无正文';
  color: var(--text-secondary);
}

.markdown-content :deep(p) {
  margin: 0 0 0.8rem;
}

.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3) {
  margin: 1rem 0 0.5rem;
  line-height: 1.3;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 0 0 0.8rem;
  padding-left: 1.4rem;
}

.markdown-content :deep(blockquote) {
  margin: 0 0 0.8rem;
  padding-left: 0.75rem;
  border-left: 3px solid var(--card-stroke);
  color: var(--text-secondary);
}

.markdown-content :deep(code) {
  padding: 0.08em 0.3em;
  border-radius: 3px;
  background: var(--card-bg-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.markdown-content :deep(a) {
  color: var(--accent-text, rgb(var(--colors-primary)));
}

.markdown-content :deep(img) {
  display: block;
  max-width: 100%;
  max-height: 32rem;
  margin: 0.5rem 0;
  border-radius: var(--radius-sm);
  object-fit: contain;
}

.markdown-content :deep(pre),
.markdown-content :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
}

.markdown-content :deep(pre) {
  padding: 0.6rem;
  border-radius: var(--radius-sm);
  background: var(--card-bg-secondary);
}

.markdown-content :deep(pre code) {
  padding: 0;
  background: transparent;
}

.markdown-content :deep(table) {
  border-collapse: collapse;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--card-stroke);
  white-space: nowrap;
}
</style>
