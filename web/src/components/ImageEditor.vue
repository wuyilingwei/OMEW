<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  constrainCropRect,
  createCropPreset,
  isGif,
  previewImage,
  processImage,
  type CropRect,
  type ImageOutputMode,
  type MosaicStroke,
} from '../utils/imageProcessing'
import { WinButton } from '../vendor/winui'

type CropCorner = 'nw' | 'ne' | 'sw' | 'se'

interface CropDragState {
  pointerId: number
  kind: 'move' | 'resize'
  corner?: CropCorner
  startX: number
  startY: number
  crop: CropRect
}

const props = withDefaults(
  defineProps<{
    file: File | null
    outputSize?: number
    cropRatio?: number | null
    cropLabel?: string
    uploading?: boolean
  }>(),
  { outputSize: 1600, cropRatio: null, cropLabel: '', uploading: false },
)
const emit = defineEmits<{ confirm: [Blob]; cancel: [] }>()

const canvas = ref<HTMLCanvasElement | null>(null)
const error = ref('')
const gif = ref(false)
const tool = ref<'crop' | 'mosaic'>('crop')
const mode = ref<ImageOutputMode>('smart')
const crop = ref<CropRect>({ x: 0, y: 0, width: 1, height: 1 })
const strokes = ref<MosaicStroke[]>([])
const gifPreviewUrl = ref('')
const busy = ref(false)
const sourceAspect = ref(1)
const viewportWidth = ref(typeof window === 'undefined' ? 1024 : window.innerWidth)
const dragging = ref<CropDragState | null>(null)
const mosaicPointerId = ref<number | null>(null)
let lastMosaicPoint: { x: number; y: number } | null = null

const canEdit = computed(() => Boolean(props.file) && !gif.value)
const locked = computed(() => busy.value || props.uploading)
const title = computed(() => (gif.value ? 'GIF 预览' : '编辑图片'))
const activeCropRatio = computed(() => (
  props.cropRatio && props.cropRatio > 0 ? props.cropRatio : undefined
))
const cropDisplayLabel = computed(() => props.cropLabel || '自由裁剪')
const stageStyle = computed(() => {
  const maxHeightVh = viewportWidth.value <= 520 ? 46 : 58
  return {
    aspectRatio: String(sourceAspect.value),
    width: `min(100%, 640px, ${Math.max(1, sourceAspect.value * maxHeightVh)}vh)`,
  }
})
const FORMAT_OPTIONS: { Text: string; Value: ImageOutputMode }[] = [
  { Text: '智能', Value: 'smart' },
  { Text: '原图', Value: 'original' },
]
const CROP_CORNERS: CropCorner[] = ['nw', 'ne', 'sw', 'se']
const MIN_CROP_EDGE = 0.08

function releaseGifPreview() {
  if (gifPreviewUrl.value) URL.revokeObjectURL(gifPreviewUrl.value)
  gifPreviewUrl.value = ''
}

function initialCrop(): CropRect {
  const ratio = activeCropRatio.value
  return ratio
    ? createCropPreset(ratio, sourceAspect.value)
    : { x: 0, y: 0, width: 1, height: 1 }
}

function clampCrop(next: CropRect): CropRect {
  return constrainCropRect(next, activeCropRatio.value, sourceAspect.value)
}

async function redraw() {
  const file = props.file
  if (!file || gif.value) return
  try {
    const rendered = await previewImage(file, {
      outputSize: props.outputSize,
      mosaic: strokes.value,
    })
    await nextTick()
    if (!canvas.value || !rendered) return
    sourceAspect.value = rendered.width / rendered.height
    canvas.value.width = rendered.width
    canvas.value.height = rendered.height
    canvas.value.getContext('2d')?.drawImage(rendered, 0, 0)
  } catch {
    error.value = '无法读取这张图片'
  }
}

async function reset(file: File | null) {
  releaseGifPreview()
  error.value = ''
  mode.value = 'smart'
  strokes.value = []
  tool.value = 'crop'
  dragging.value = null
  mosaicPointerId.value = null
  lastMosaicPoint = null
  sourceAspect.value = 1
  gif.value = file ? await isGif(file) : false
  if (file !== props.file) return
  if (gif.value && file) gifPreviewUrl.value = URL.createObjectURL(file)
  await redraw()
  crop.value = initialCrop()
}

watch(() => props.file, (file) => void reset(file), { immediate: true })
watch(() => props.cropRatio, () => {
  if (props.file) crop.value = initialCrop()
})
watch(strokes, () => void redraw(), { deep: true })

function updateViewportWidth() {
  viewportWidth.value = window.innerWidth
}

onMounted(() => window.addEventListener('resize', updateViewportWidth))
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewportWidth)
  dragging.value = null
  mosaicPointerId.value = null
  releaseGifPreview()
})

function stagePoint(event: PointerEvent): { x: number; y: number } | null {
  const rect = canvas.value?.getBoundingClientRect()
  if (!rect) return null
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  }
}

function paint(event: PointerEvent) {
  if (
    tool.value !== 'mosaic'
    || !canEdit.value
    || locked.value
    || mosaicPointerId.value !== event.pointerId
  ) return
  const current = stagePoint(event)
  if (!current) return
  const previous = lastMosaicPoint ?? current
  const distance = Math.hypot(current.x - previous.x, current.y - previous.y)
  const steps = Math.max(1, Math.ceil(distance / 0.025))
  const additions: MosaicStroke[] = []
  for (let index = 0; index <= steps; index += 1) {
    additions.push({
      x: previous.x + ((current.x - previous.x) * index) / steps,
      y: previous.y + ((current.y - previous.y) * index) / steps,
      radius: 0.04,
    })
  }
  strokes.value.push(...additions)
  lastMosaicPoint = current
}

function onStagePointerDown(event: PointerEvent) {
  if (!canEdit.value || locked.value || tool.value !== 'mosaic') return
  mosaicPointerId.value = event.pointerId
  lastMosaicPoint = null
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  paint(event)
}

function beginCropDrag(event: PointerEvent, kind: CropDragState['kind'], corner?: CropCorner) {
  if (!canEdit.value || locked.value) return
  const point = stagePoint(event)
  if (!point) return
  dragging.value = {
    pointerId: event.pointerId,
    kind,
    corner,
    startX: point.x,
    startY: point.y,
    crop: { ...crop.value },
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  event.preventDefault()
  event.stopPropagation()
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function moveCrop(source: CropRect, dx: number, dy: number): CropRect {
  return {
    ...source,
    x: clamp(source.x + dx, 0, 1 - source.width),
    y: clamp(source.y + dy, 0, 1 - source.height),
  }
}

function resizeFreeCrop(source: CropRect, corner: CropCorner, dx: number, dy: number): CropRect {
  const originalRight = source.x + source.width
  const originalBottom = source.y + source.height
  const fromLeft = corner.includes('w')
  const fromTop = corner.includes('n')
  const left = fromLeft
    ? clamp(source.x + dx, 0, originalRight - MIN_CROP_EDGE)
    : source.x
  const top = fromTop
    ? clamp(source.y + dy, 0, originalBottom - MIN_CROP_EDGE)
    : source.y
  const right = fromLeft
    ? originalRight
    : clamp(originalRight + dx, source.x + MIN_CROP_EDGE, 1)
  const bottom = fromTop
    ? originalBottom
    : clamp(originalBottom + dy, source.y + MIN_CROP_EDGE, 1)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function resizePresetCrop(source: CropRect, corner: CropCorner, dx: number, dy: number): CropRect {
  const normalizedRatio = (activeCropRatio.value ?? 1) / sourceAspect.value
  const fromLeft = corner.includes('w')
  const fromTop = corner.includes('n')
  const anchorX = fromLeft ? source.x + source.width : source.x
  const anchorY = fromTop ? source.y + source.height : source.y
  const pointerX = fromLeft ? source.x + dx : source.x + source.width + dx
  const pointerY = fromTop ? source.y + dy : source.y + source.height + dy
  const rawWidth = Math.abs(pointerX - anchorX)
  const rawHeight = Math.abs(pointerY - anchorY)
  let width: number
  let height: number
  if (rawWidth / Math.max(rawHeight, Number.EPSILON) > normalizedRatio) {
    width = rawWidth
    height = width / normalizedRatio
  } else {
    height = rawHeight
    width = height * normalizedRatio
  }

  const minimumWidth = normalizedRatio >= 1 ? MIN_CROP_EDGE * normalizedRatio : MIN_CROP_EDGE
  const minimumHeight = normalizedRatio >= 1 ? MIN_CROP_EDGE : MIN_CROP_EDGE / normalizedRatio
  width = Math.max(width, minimumWidth)
  height = Math.max(height, minimumHeight)

  const maxWidth = fromLeft ? anchorX : 1 - anchorX
  const maxHeight = fromTop ? anchorY : 1 - anchorY
  const boundaryScale = Math.min(1, maxWidth / width, maxHeight / height)
  width *= boundaryScale
  height *= boundaryScale

  return clampCrop({
    x: fromLeft ? anchorX - width : anchorX,
    y: fromTop ? anchorY - height : anchorY,
    width,
    height,
  })
}

function onStagePointerMove(event: PointerEvent) {
  if (tool.value === 'mosaic') {
    paint(event)
    return
  }
  const state = dragging.value
  if (!state || state.pointerId !== event.pointerId) return
  const point = stagePoint(event)
  if (!point) return
  const dx = point.x - state.startX
  const dy = point.y - state.startY
  if (state.kind === 'move') {
    crop.value = moveCrop(state.crop, dx, dy)
    return
  }
  if (!state.corner) return
  crop.value = activeCropRatio.value
    ? resizePresetCrop(state.crop, state.corner, dx, dy)
    : resizeFreeCrop(state.crop, state.corner, dx, dy)
}

function onStagePointerUp(event: PointerEvent) {
  if (mosaicPointerId.value === event.pointerId) {
    mosaicPointerId.value = null
    lastMosaicPoint = null
  }
  if (dragging.value?.pointerId === event.pointerId) dragging.value = null
}

function resetCrop() {
  crop.value = initialCrop()
  tool.value = 'crop'
}

function clearMosaic() {
  strokes.value = []
}

async function confirm() {
  if (!props.file || locked.value) return
  busy.value = true
  error.value = ''
  try {
    const processed = await processImage(props.file, {
      mode: mode.value,
      outputSize: props.outputSize,
      crop: crop.value,
      mosaic: strokes.value,
    })
    emit('confirm', processed.blob)
    await nextTick()
  } catch {
    error.value = '无法处理这张图片'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="file" class="image-editor__overlay" @click.self="!locked && emit('cancel')">
      <section class="image-editor" role="dialog" aria-modal="true" :aria-label="title">
        <div class="image-editor__header">
          <div class="image-editor__heading">
            <h2>{{ title }}</h2>
            <span>{{ file.name }}</span>
          </div>
          <WinButton Style="SubtleButtonStyle" :IsEnabled="!locked" @click="emit('cancel')">关闭</WinButton>
        </div>

        <p v-if="gif" class="image-editor__note">GIF 保留动画，只能预览并按原图上传。</p>
        <div v-if="gif" class="image-editor__gif-stage">
          <img class="image-editor__gif" :src="gifPreviewUrl" alt="GIF 预览" />
        </div>

        <div
          v-else
          class="image-editor__stage"
          :style="stageStyle"
          :class="{ 'is-mosaic': tool === 'mosaic' }"
          @pointerdown="onStagePointerDown"
          @pointermove="onStagePointerMove"
          @pointerup="onStagePointerUp"
          @pointercancel="onStagePointerUp"
        >
          <canvas ref="canvas" class="image-editor__canvas" />
          <template v-if="tool === 'crop'">
            <div class="image-editor__mask image-editor__mask--top" :style="{ height: `${crop.y * 100}%` }" />
            <div class="image-editor__mask image-editor__mask--bottom" :style="{ top: `${(crop.y + crop.height) * 100}%` }" />
            <div
              class="image-editor__mask image-editor__mask--left"
              :style="{ top: `${crop.y * 100}%`, width: `${crop.x * 100}%`, height: `${crop.height * 100}%` }"
            />
            <div
              class="image-editor__mask image-editor__mask--right"
              :style="{ top: `${crop.y * 100}%`, left: `${(crop.x + crop.width) * 100}%`, height: `${crop.height * 100}%` }"
            />
            <div
              class="image-editor__crop-box"
              :style="{
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.width * 100}%`,
                height: `${crop.height * 100}%`,
              }"
              :aria-label="cropDisplayLabel"
              @pointerdown="beginCropDrag($event, 'move')"
            >
              <button
                v-for="corner in CROP_CORNERS"
                :key="corner"
                type="button"
                class="image-editor__handle"
                :class="`is-${corner}`"
                :aria-label="`调整裁剪框 ${corner}`"
                @pointerdown="beginCropDrag($event, 'resize', corner)"
              ></button>
            </div>
          </template>
        </div>

        <div v-if="canEdit" class="image-editor__toolbar">
          <div class="image-editor__tool-group">
            <span class="image-editor__crop-label">{{ cropDisplayLabel }}</span>
            <WinButton
              :Style="tool === 'crop' ? 'AccentButtonStyle' : 'DefaultButtonStyle'"
              :IsEnabled="!locked"
              @click="tool = 'crop'"
            >裁剪</WinButton>
            <WinButton
              :Style="tool === 'mosaic' ? 'AccentButtonStyle' : 'DefaultButtonStyle'"
              :IsEnabled="!locked"
              @click="tool = 'mosaic'"
            >马赛克</WinButton>
            <WinButton Style="SubtleButtonStyle" :IsEnabled="!locked" @click="resetCrop">重置裁剪</WinButton>
            <WinButton
              v-if="strokes.length"
              Style="SubtleButtonStyle"
              :IsEnabled="!locked"
              @click="clearMosaic"
            >清除马赛克</WinButton>
          </div>
          <div class="image-editor__format" role="radiogroup" aria-label="输出格式">
            <button
              v-for="option in FORMAT_OPTIONS"
              :key="option.Value"
              type="button"
              role="radio"
              :class="{ selected: mode === option.Value }"
              :aria-checked="mode === option.Value"
              :disabled="locked"
              @click="mode = option.Value"
            >{{ option.Text }}</button>
          </div>
        </div>

        <p v-if="error" class="field__error">{{ error }}</p>
        <div class="image-editor__actions">
          <WinButton Style="SubtleButtonStyle" :IsEnabled="!locked" @click="emit('cancel')">取消</WinButton>
          <WinButton Style="AccentButtonStyle" :IsEnabled="!locked" @click="confirm">
            {{ locked ? '处理中或上传中…' : '确认并上传' }}
          </WinButton>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.image-editor__overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: var(--overlay-scrim);
}

.image-editor {
  width: min(100%, 780px);
  max-height: calc(100vh - 2rem);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1.15rem;
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-md);
  background: var(--dialog-background);
  box-shadow: var(--shadow-dialog);
}

.image-editor__header,
.image-editor__toolbar,
.image-editor__tool-group,
.image-editor__actions {
  display: flex;
  align-items: center;
}

.image-editor__header {
  justify-content: space-between;
  gap: 1rem;
}

.image-editor__heading {
  min-width: 0;
}

.image-editor__heading h2,
.image-editor__note {
  margin: 0;
}

.image-editor__heading span,
.image-editor__note {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.image-editor__heading span {
  display: block;
  max-width: 34rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-editor__stage {
  position: relative;
  align-self: center;
  overflow: hidden;
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-sm);
  background:
    linear-gradient(45deg, var(--ctrl-fill-secondary) 25%, transparent 25%) 0 0 / 16px 16px,
    linear-gradient(45deg, transparent 75%, var(--ctrl-fill-secondary) 75%) 0 0 / 16px 16px,
    linear-gradient(45deg, transparent 25%, var(--ctrl-fill-secondary) 25%) 8px 8px / 16px 16px,
    linear-gradient(45deg, var(--ctrl-fill-secondary) 75%, transparent 75%) 8px 8px / 16px 16px,
    var(--layer-alt);
  box-shadow: var(--shadow-card);
}

.image-editor__stage.is-mosaic {
  cursor: crosshair;
  touch-action: none;
}

.image-editor__canvas {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
}

.image-editor__gif-stage {
  display: grid;
  place-items: center;
  max-height: 58vh;
  overflow: hidden;
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-sm);
  background: var(--ctrl-fill-secondary);
}

.image-editor__gif {
  display: block;
  max-width: 100%;
  max-height: 58vh;
  object-fit: contain;
}

.image-editor__mask {
  position: absolute;
  z-index: 1;
  background: rgb(0 0 0 / 58%);
  pointer-events: none;
}

.image-editor__mask--top {
  inset: 0 0 auto;
}

.image-editor__mask--bottom {
  right: 0;
  bottom: 0;
  left: 0;
}

.image-editor__mask--left {
  left: 0;
}

.image-editor__mask--right {
  right: 0;
}

.image-editor__crop-box {
  position: absolute;
  z-index: 2;
  border: 2px solid rgb(var(--colors-primary));
  border-radius: 2px;
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 72%),
    0 0 0 2px rgb(0 0 0 / 45%);
  cursor: move;
  touch-action: none;
}

.image-editor__crop-box::before,
.image-editor__crop-box::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.image-editor__crop-box::before {
  inset: 33.333% 0;
  border-block: 1px solid rgb(255 255 255 / 42%);
}

.image-editor__crop-box::after {
  inset: 0 33.333%;
  border-inline: 1px solid rgb(255 255 255 / 42%);
}

.image-editor__handle {
  position: absolute;
  z-index: 1;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 2px solid white;
  border-radius: 4px;
  background: rgb(var(--colors-primary));
  box-shadow: 0 1px 3px rgb(0 0 0 / 45%);
}

.image-editor__handle.is-nw {
  top: -1px;
  left: -1px;
  cursor: nwse-resize;
}

.image-editor__handle.is-ne {
  top: -1px;
  right: -1px;
  cursor: nesw-resize;
}

.image-editor__handle.is-sw {
  bottom: -1px;
  left: -1px;
  cursor: nesw-resize;
}

.image-editor__handle.is-se {
  right: -1px;
  bottom: -1px;
  cursor: nwse-resize;
}

.image-editor__toolbar {
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 0.7rem;
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-sm);
  background: var(--card-bg-secondary);
}

.image-editor__tool-group {
  min-width: 0;
  gap: 0.45rem;
  flex-wrap: wrap;
}

.image-editor__crop-label {
  padding: 0.3rem 0.55rem;
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--ctrl-fill-secondary);
  font-size: 0.8rem;
  white-space: nowrap;
}

.image-editor__format {
  display: inline-flex;
  flex: 0 0 auto;
  overflow: hidden;
  padding: 2px;
  border: 1px solid var(--ctrl-border);
  border-radius: var(--radius-sm);
  background: var(--ctrl-fill-secondary);
}

.image-editor__format button {
  min-width: 4rem;
  padding: 0.4rem 0.75rem;
  border: 0;
  border-radius: calc(var(--radius-sm) - 2px);
  color: var(--text-secondary);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.image-editor__format button:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--ctrl-fill-tertiary);
}

.image-editor__format button.selected {
  color: var(--on-accent);
  background: rgb(var(--colors-primary));
}

.image-editor__format button:focus-visible {
  outline: 2px solid rgb(var(--colors-primary));
  outline-offset: -2px;
}

.image-editor__format button:disabled {
  cursor: default;
  opacity: 0.55;
}

.image-editor__actions {
  justify-content: flex-end;
  gap: 0.6rem;
}

@media (max-width: 520px) {
  .image-editor__overlay {
    padding: 0.5rem;
  }

  .image-editor {
    max-height: calc(100vh - 1rem);
    padding: 0.8rem;
  }

  .image-editor__toolbar,
  .image-editor__tool-group {
    align-items: stretch;
  }

  .image-editor__crop-label {
    flex-basis: 100%;
  }

  .image-editor__format {
    width: 100%;
  }

  .image-editor__format button {
    flex: 1 1 50%;
  }
}
</style>
