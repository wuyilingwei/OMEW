<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { HOME_WORLD, HOME_WORLD_LAYERS } from '../assets/mew'

type WorldLayer = {
  key: string
  src: string
  depthX: number
  depthY: number
  scale: number
  idleFromX: string
  idleFromY: string
  idleToX: string
  idleToY: string
}

const world = ref<HTMLElement | null>(null)
const layers: WorldLayer[] = [
  { key: 'sky', src: HOME_WORLD, depthX: 2, depthY: 1.5, scale: 1.04, idleFromX: '-1px', idleFromY: '0px', idleToX: '1px', idleToY: '-1px' },
  { key: 'glow-far', src: HOME_WORLD_LAYERS.glowFar, depthX: 5, depthY: 3, scale: 1, idleFromX: '-3px', idleFromY: '2px', idleToX: '3px', idleToY: '-2px' },
  { key: 'glow-near', src: HOME_WORLD_LAYERS.glowNear, depthX: 16, depthY: 10, scale: 1, idleFromX: '7px', idleFromY: '-5px', idleToX: '-7px', idleToY: '5px' },
  { key: 'city', src: HOME_WORLD_LAYERS.city, depthX: 13, depthY: 8, scale: 1.07, idleFromX: '-5px', idleFromY: '3px', idleToX: '5px', idleToY: '-3px' },
  { key: 'clouds', src: HOME_WORLD_LAYERS.clouds, depthX: 18, depthY: 12, scale: 1.09, idleFromX: '7px', idleFromY: '-4px', idleToX: '-7px', idleToY: '4px' },
  { key: 'foreground', src: HOME_WORLD_LAYERS.foreground, depthX: 26, depthY: 18, scale: 1.12, idleFromX: '-9px', idleFromY: '6px', idleToX: '9px', idleToY: '-6px' },
  { key: 'atmosphere', src: HOME_WORLD_LAYERS.atmosphere, depthX: 32, depthY: 23, scale: 1.16, idleFromX: '-11px', idleFromY: '7px', idleToX: '11px', idleToY: '-7px' },
]

let layerElements: HTMLElement[] = []
let finePointerQuery: MediaQueryList | null = null
let reducedMotionQuery: MediaQueryList | null = null
let animationFrame = 0
let targetX = 0
let targetY = 0
let currentX = 0
let currentY = 0

function layerStyle(layer: WorldLayer, index: number) {
  return {
    '--layer-scale': String(layer.scale),
    '--layer-delay': `${index * 70}ms`,
    '--idle-delay': `${index * -0.9}s`,
    '--idle-from-x': layer.idleFromX,
    '--idle-from-y': layer.idleFromY,
    '--idle-to-x': layer.idleToX,
    '--idle-to-y': layer.idleToY,
  }
}

function applyTransforms(x: number, y: number) {
  layerElements.forEach((element, index) => {
    const layer = layers[index]
    if (!layer) return
    element.style.setProperty('--shift-x', `${(x * layer.depthX).toFixed(2)}px`)
    element.style.setProperty('--shift-y', `${(-y * layer.depthY).toFixed(2)}px`)
  })
}

function animateTowardPointer() {
  const ease = 0.075
  currentX += (targetX - currentX) * ease
  currentY += (targetY - currentY) * ease
  applyTransforms(currentX, currentY)

  if (Math.abs(targetX - currentX) > 0.001 || Math.abs(targetY - currentY) > 0.001) {
    animationFrame = requestAnimationFrame(animateTowardPointer)
  } else {
    currentX = targetX
    currentY = targetY
    applyTransforms(currentX, currentY)
    animationFrame = 0
  }
}

function scheduleAnimation() {
  if (!animationFrame) animationFrame = requestAnimationFrame(animateTowardPointer)
}

function resetPointer() {
  targetX = 0
  targetY = 0
  scheduleAnimation()
}

function handlePointerMove(event: PointerEvent) {
  const element = world.value
  if (!element || !finePointerQuery?.matches || reducedMotionQuery?.matches) return

  const rect = element.getBoundingClientRect()
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
    resetPointer()
    return
  }

  targetX = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2))
  targetY = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2))
  scheduleAnimation()
}

function handlePointerOut(event: PointerEvent) {
  if (!event.relatedTarget) resetPointer()
}

function handleMotionPreference() {
  if (!reducedMotionQuery?.matches) return
  cancelAnimationFrame(animationFrame)
  animationFrame = 0
  targetX = 0
  targetY = 0
  currentX = 0
  currentY = 0
  applyTransforms(0, 0)
}

onMounted(() => {
  layerElements = Array.from(world.value?.querySelectorAll<HTMLElement>('[data-landing-layer]') ?? [])
  finePointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)')
  reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotionQuery.addEventListener('change', handleMotionPreference)
  window.addEventListener('pointermove', handlePointerMove, { passive: true })
  window.addEventListener('pointerout', handlePointerOut)
  window.addEventListener('blur', resetPointer)
  applyTransforms(0, 0)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(animationFrame)
  reducedMotionQuery?.removeEventListener('change', handleMotionPreference)
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerout', handlePointerOut)
  window.removeEventListener('blur', resetPointer)
})
</script>

<template>
  <div ref="world" class="landing-world" aria-hidden="true">
    <div
      v-for="(layer, index) in layers"
      :key="layer.key"
      class="landing-world__layer"
      :class="`landing-world__layer--${layer.key}`"
      :style="layerStyle(layer, index)"
      :data-landing-layer="layer.key"
    >
      <img class="landing-world__art" :src="layer.src" alt="" draggable="false" />
    </div>
  </div>
</template>

<style scoped>
.landing-world {
  overflow: hidden;
  pointer-events: none;
  user-select: none;
  background: #14233f;
  contain: paint;
}

.landing-world__layer {
  --shift-x: 0px;
  --shift-y: 0px;
  position: absolute;
  inset: -5%;
  display: grid;
  place-items: center;
  opacity: 0;
  transform: translate3d(var(--shift-x), var(--shift-y), 0) scale(var(--layer-scale));
  transform-origin: center;
  will-change: transform;
  animation: landing-layer-arrive 900ms var(--fast-out-slow-in, ease-out) var(--layer-delay) forwards;
}

.landing-world__art {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  -webkit-user-drag: none;
}

.landing-world__layer--glow-far,
.landing-world__layer--glow-near {
  inset: 0;
}

.landing-world__layer--glow-far .landing-world__art,
.landing-world__layer--glow-near .landing-world__art {
  width: min(122vmin, 92vw);
  height: min(122vmin, 92vw);
  object-fit: contain;
  opacity: 0.68;
}

.landing-world__layer--glow-far .landing-world__art {
  translate: -9% -7%;
  animation: landing-glow-clockwise 58s linear infinite;
}

.landing-world__layer--glow-near .landing-world__art {
  width: min(72vmin, 56vw);
  height: min(72vmin, 56vw);
  translate: 12% 10%;
  opacity: 0.76;
  animation: landing-glow-counterclockwise 46s linear infinite;
}

@keyframes landing-layer-arrive {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes landing-glow-clockwise {
  to { transform: rotate(360deg); }
}

@keyframes landing-glow-counterclockwise {
  to { transform: rotate(-360deg); }
}

@keyframes landing-touch-drift {
  from { transform: translate3d(var(--idle-from-x), var(--idle-from-y), 0) scale(var(--layer-scale)); }
  to { transform: translate3d(var(--idle-to-x), var(--idle-to-y), 0) scale(var(--layer-scale)); }
}

@media (hover: none), (pointer: coarse) {
  .landing-world__layer {
    animation:
      landing-layer-arrive 900ms var(--fast-out-slow-in, ease-out) var(--layer-delay) forwards,
      landing-touch-drift 13s ease-in-out var(--idle-delay) infinite alternate;
  }
}

@media (max-width: 700px) {
  .landing-world__art {
    object-position: 59% center;
  }

  .landing-world__layer--glow-far .landing-world__art,
  .landing-world__layer--glow-near .landing-world__art {
    translate: 9% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .landing-world__layer,
  .landing-world__layer--glow-far .landing-world__art,
  .landing-world__layer--glow-near .landing-world__art {
    opacity: 1;
    animation: none;
  }

  .landing-world__layer {
    transform: scale(var(--layer-scale));
  }
}
</style>
