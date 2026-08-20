<script setup lang="ts">
import { computed } from 'vue'
import { ICON_PATHS, ICON_PATHS_FILLED, type FilledIconName, type IconName } from './paths'

// 统一内联 SVG 图标：Fluent 线性风格，viewBox 24x24，圆头描边，stroke=currentColor。
// size 决定渲染像素，默认随字号（1em）走。
const props = withDefaults(
  defineProps<{
    name: IconName | FilledIconName
    size?: number | string
  }>(),
  { size: '1em' },
)

const isFilled = computed(() => props.name in ICON_PATHS_FILLED)
const strokeSegments = computed(() => (isFilled.value ? [] : ICON_PATHS[props.name as IconName].split(' M').map((seg, i) => (i === 0 ? seg : `M${seg}`))))
const filledPath = computed(() => (isFilled.value ? ICON_PATHS_FILLED[props.name as FilledIconName] : ''))
const px = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size))
</script>

<template>
  <svg
    class="app-icon"
    :width="px"
    :height="px"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <path v-if="isFilled" :d="filledPath" fill="currentColor" />
    <path
      v-for="(seg, i) in strokeSegments"
      :key="i"
      :d="seg"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<style scoped>
.app-icon {
  display: inline-block;
  flex: 0 0 auto;
  vertical-align: -0.125em;
}
</style>
