<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { isGif, previewImage, processImage, type ImageOutputMode, type MosaicStroke } from '../utils/imageProcessing'
import { WinButton, WinComboBox } from '../vendor/winui'

const props = withDefaults(defineProps<{ file: File | null; square?: boolean; outputSize?: number }>(), { square: false, outputSize: 1600 })
const emit = defineEmits<{ confirm: [Blob]; cancel: [] }>()

const canvas = ref<HTMLCanvasElement | null>(null)
const error = ref('')
const gif = ref(false)
const cropEnabled = ref(props.square)
const mosaicEnabled = ref(false)
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const strokes = ref<MosaicStroke[]>([])
const mode = ref<ImageOutputMode>('auto')
const gifPreviewUrl = ref('')
const busy = ref(false)
let pointerId: number | null = null
let lastPoint: { x: number; y: number } | null = null

const canEdit = computed(() => props.file !== null && !gif.value)
const title = computed(() => gif.value ? 'GIF 预览' : '编辑图片')
const FORMAT_OPTIONS: { Text: string; Value: ImageOutputMode }[] = [
  { Text: '自动', Value: 'auto' },
  { Text: 'WebP', Value: 'webp' },
  { Text: 'JPEG', Value: 'jpeg' },
  { Text: 'PNG', Value: 'png' },
  { Text: '原图', Value: 'original' },
]

function releaseGifPreview() {
  if (gifPreviewUrl.value) URL.revokeObjectURL(gifPreviewUrl.value)
  gifPreviewUrl.value = ''
}

async function redraw() {
  const file = props.file
  if (!file || gif.value) return
  try {
    const rendered = await previewImage(file, {
      outputSize: props.outputSize,
      crop: cropEnabled.value ? { zoom: zoom.value, panX: panX.value, panY: panY.value } : undefined,
      mosaic: strokes.value,
    })
    await nextTick()
    if (!canvas.value || !rendered) return
    canvas.value.width = rendered.width
    canvas.value.height = rendered.height
    const ctx = canvas.value.getContext('2d')
    ctx?.drawImage(rendered, 0, 0)
  } catch {
    error.value = '无法读取这张图片'
  }
}

async function reset(file: File | null) {
  releaseGifPreview()
  error.value = ''
  gif.value = file ? await isGif(file) : false
  if (file !== props.file) return
  if (gif.value && file) gifPreviewUrl.value = URL.createObjectURL(file)
  cropEnabled.value = props.square
  mosaicEnabled.value = false
  zoom.value = 1
  panX.value = 0
  panY.value = 0
  strokes.value = []
  await redraw()
}

watch(() => props.file, (file) => void reset(file), { immediate: true })
watch([cropEnabled, zoom, panX, panY, strokes], () => void redraw(), { deep: true })
onBeforeUnmount(() => { pointerId = null; releaseGifPreview() })

function point(event: PointerEvent): { x: number; y: number } | null {
  const rect = canvas.value?.getBoundingClientRect()
  if (!rect) return null
  return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
}

function paint(event: PointerEvent) {
  if (!mosaicEnabled.value || !canEdit.value) return
  const current = point(event)
  if (!current) return
  const previous = lastPoint ?? current
  const distance = Math.hypot(current.x - previous.x, current.y - previous.y)
  const steps = Math.max(1, Math.ceil(distance / 0.025))
  for (let i = 0; i <= steps; i += 1) {
    strokes.value.push({ x: previous.x + ((current.x - previous.x) * i) / steps, y: previous.y + ((current.y - previous.y) * i) / steps, radius: 42 })
  }
  lastPoint = current
}

function onPointerDown(event: PointerEvent) {
  if (!canEdit.value) return
  pointerId = event.pointerId
  lastPoint = point(event)
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  paint(event)
}

function onPointerMove(event: PointerEvent) {
  if (pointerId === event.pointerId) paint(event)
}

function onPointerUp(event: PointerEvent) {
  if (pointerId === event.pointerId) {
    pointerId = null
    lastPoint = null
  }
}

async function confirm() {
  if (!props.file) return
  busy.value = true
  error.value = ''
  try {
    const processed = await processImage(props.file, {
      mode: mode.value,
      outputSize: props.outputSize,
      crop: cropEnabled.value ? { zoom: zoom.value, panX: panX.value, panY: panY.value } : undefined,
      mosaic: strokes.value,
    })
    emit('confirm', processed.blob)
  } catch {
    error.value = '无法处理这张图片'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="file" class="image-editor__overlay" @click.self="!busy && emit('cancel')">
      <section class="image-editor" role="dialog" aria-modal="true" :aria-label="title">
        <div class="image-editor__header"><h2>{{ title }}</h2><span>{{ file.name }}</span></div>
        <p v-if="gif" class="image-editor__note">GIF 为保留动画，只能按原图上传，不能裁剪、打码或转换格式。</p>
        <img v-if="gif" class="image-editor__gif" :src="gifPreviewUrl" alt="GIF 预览" />
        <canvas v-else ref="canvas" class="image-editor__canvas" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp" />
        <div v-if="canEdit" class="image-editor__tools">
          <label><input v-model="cropEnabled" type="checkbox" /> 裁剪为方形</label>
          <label v-if="cropEnabled">缩放 <input v-model.number="zoom" type="range" min="1" max="3" step="0.01" /></label>
          <label v-if="cropEnabled">水平 <input v-model.number="panX" type="range" min="-1" max="1" step="0.01" /></label>
          <label v-if="cropEnabled">垂直 <input v-model.number="panY" type="range" min="-1" max="1" step="0.01" /></label>
          <WinButton Style="DefaultButtonStyle" @click="mosaicEnabled = !mosaicEnabled">{{ mosaicEnabled ? '正在涂抹马赛克' : '打马赛克' }}</WinButton>
          <WinButton v-if="strokes.length" Style="SubtleButtonStyle" @click="strokes = []">清除马赛克</WinButton>
          <WinComboBox :ItemsSource="FORMAT_OPTIONS" SelectedValuePath="Value" v-model:SelectedValue="mode" Header="输出格式" />
        </div>
        <p v-if="error" class="field__error">{{ error }}</p>
        <div class="image-editor__actions"><WinButton Style="SubtleButtonStyle" :IsEnabled="!busy" @click="emit('cancel')">取消</WinButton><WinButton Style="AccentButtonStyle" :IsEnabled="!busy" @click="confirm">{{ busy ? '处理中…' : '确认并上传' }}</WinButton></div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.image-editor__overlay { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 1rem; background: var(--overlay-scrim); }
.image-editor { width: min(100%, 680px); max-height: calc(100vh - 2rem); overflow: auto; display: flex; flex-direction: column; gap: .75rem; padding: 1.25rem; border: 1px solid var(--card-stroke); border-radius: var(--radius-md); background: var(--flyout-bg, var(--layer-default)); box-shadow: var(--shadow-dialog); }
.image-editor__header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }.image-editor__header h2,.image-editor__note { margin: 0; }.image-editor__header span,.image-editor__note { color: var(--text-secondary); font-size: .85rem; }
.image-editor__canvas { width: min(100%, 480px); max-height: 52vh; align-self: center; object-fit: contain; background: var(--ctrl-fill-secondary); border-radius: var(--radius-sm); touch-action: none; cursor: crosshair; }
.image-editor__gif { width: min(100%, 480px); max-height: 52vh; align-self: center; object-fit: contain; background: var(--ctrl-fill-secondary); border-radius: var(--radius-sm); }
.image-editor__tools { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; }.image-editor__tools label { display: flex; align-items: center; gap: .35rem; font-size: .85rem; }.image-editor__tools input[type='range'] { width: 7rem; }
.image-editor__actions { display: flex; justify-content: flex-end; gap: .6rem; }
</style>
