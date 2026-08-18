<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { clampWidth } from '../composables/useColumnResize'

const props = defineProps<{
  varName: '--left-width' | '--right-width'
  storageKey: string
  defaultPercent: number
  /** true for the handle on the right side of the shell, where dragging
   *  right should shrink (not grow) the column it controls */
  invert?: boolean
}>()

const dragging = ref(false)
let startX = 0
let startPercent = 0
let containerWidth = 0

function currentPercent(): number {
  const raw = document.body.style.getPropertyValue(props.varName)
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : props.defaultPercent
}

function applyPercent(value: number) {
  const clamped = clampWidth(value)
  document.body.style.setProperty(props.varName, `${clamped}%`)
  localStorage.setItem(props.storageKey, String(clamped))
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value || containerWidth === 0) return
  const deltaPercent = ((event.clientX - startX) / containerWidth) * 100
  applyPercent(props.invert ? startPercent - deltaPercent : startPercent + deltaPercent)
}

function onPointerUp() {
  dragging.value = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
}

function onPointerDown(event: PointerEvent) {
  if (window.innerWidth <= 768) return
  const shellBody = (event.currentTarget as HTMLElement).closest('.shell__body') as HTMLElement | null
  containerWidth = shellBody?.clientWidth ?? window.innerWidth
  startX = event.clientX
  startPercent = currentPercent()
  dragging.value = true
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  event.preventDefault()
}

function onDoubleClick() {
  applyPercent(props.defaultPercent)
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
})
</script>

<template>
  <div
    class="column-resizer"
    :class="{ 'column-resizer--active': dragging }"
    role="separator"
    aria-orientation="vertical"
    title="拖拽调整宽度，双击恢复默认"
    @pointerdown="onPointerDown"
    @dblclick="onDoubleClick"
  />
</template>

<style scoped>
.column-resizer {
  flex: 0 0 6px;
  width: 6px;
  cursor: col-resize;
  position: relative;
  z-index: 5;
  touch-action: none;
}

.column-resizer::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 2px;
  border-radius: 999px;
  background: transparent;
  transition: background var(--fast-duration) var(--fast-out-slow-in);
}

.column-resizer:hover::after,
.column-resizer--active::after {
  background: rgb(var(--colors-primary) / 0.55);
}

@media (max-width: 768px) {
  .column-resizer {
    display: none;
  }
}
</style>
