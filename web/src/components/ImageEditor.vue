<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { constrainCropRect, createCropPreset, isGif, previewImage, processImage, type CropRect, type ImageOutputMode, type MosaicStroke } from '../utils/imageProcessing'
import { WinButton } from '../vendor/winui'

const props = withDefaults(defineProps<{ file: File | null; outputSize?: number; cropRatio?: number | null; cropLabel?: string; uploading?: boolean }>(), { outputSize: 1600, cropRatio: null, cropLabel: '', uploading: false })
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
const dragging = ref<{ pointerId: number; kind: 'move' | 'resize'; corner?: string; startX: number; startY: number; crop: CropRect } | null>(null)
const mosaicPointerId = ref<number | null>(null)
const canEdit = computed(() => Boolean(props.file) && !gif.value)
const locked = computed(() => busy.value || props.uploading)
const title = computed(() => gif.value ? 'GIF 预览' : '编辑图片')
const FORMAT_OPTIONS: { Text: string; Value: ImageOutputMode }[] = [{ Text: '智能', Value: 'smart' }, { Text: '原图', Value: 'original' }]
const stageStyle = computed(() => ({ aspectRatio: String(sourceAspect.value) }))

function releaseGifPreview() { if (gifPreviewUrl.value) URL.revokeObjectURL(gifPreviewUrl.value); gifPreviewUrl.value = '' }
function initialCrop(): CropRect { return props.cropRatio && props.cropRatio > 0 ? createCropPreset(props.cropRatio, sourceAspect.value) : { x: 0, y: 0, width: 1, height: 1 } }
function clampCrop(next: CropRect): CropRect { return constrainCropRect(next, props.cropRatio && props.cropRatio > 0 ? props.cropRatio : null, sourceAspect.value) }
async function redraw() {
  const file = props.file; if (!file || gif.value) return
  try {
    const rendered = await previewImage(file, { outputSize: props.outputSize, mosaic: strokes.value }); await nextTick()
    if (!canvas.value || !rendered) return
    sourceAspect.value = rendered.width / rendered.height
    canvas.value.width = rendered.width; canvas.value.height = rendered.height; canvas.value.getContext('2d')?.drawImage(rendered, 0, 0)
  } catch { error.value = '无法读取这张图片' }
}
async function reset(file: File | null) {
  releaseGifPreview(); error.value = ''; mode.value = 'smart'; strokes.value = []; tool.value = 'crop'; dragging.value = null; sourceAspect.value = 1
  gif.value = file ? await isGif(file) : false; if (file !== props.file) return
  if (gif.value && file) gifPreviewUrl.value = URL.createObjectURL(file)
  await redraw(); crop.value = initialCrop()
}
watch(() => props.file, (file) => void reset(file), { immediate: true }); watch(() => props.cropRatio, () => { if (props.file) crop.value = initialCrop() }); watch(strokes, () => void redraw(), { deep: true }); onBeforeUnmount(() => { dragging.value = null; releaseGifPreview() })
function stagePoint(event: PointerEvent) { const rect = canvas.value?.getBoundingClientRect(); if (!rect) return null; return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) } }
function paint(event: PointerEvent) { if (tool.value !== 'mosaic' || !canEdit.value || locked.value || mosaicPointerId.value !== event.pointerId) return; const point = stagePoint(event); if (!point) return; const previous = strokes.value.at(-1); if (!previous) { strokes.value.push({ x: point.x, y: point.y, radius: 0.04 }); return }; const distance = Math.hypot(point.x - previous.x, point.y - previous.y); const steps = Math.max(1, Math.ceil(distance / 0.025)); for (let i = 1; i <= steps; i += 1) strokes.value.push({ x: previous.x + ((point.x - previous.x) * i) / steps, y: previous.y + ((point.y - previous.y) * i) / steps, radius: 0.04 }) }
function onStagePointerDown(event: PointerEvent) { if (!canEdit.value || locked.value) return; if (tool.value === 'mosaic') { mosaicPointerId.value = event.pointerId; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); paint(event) } }
function beginCropDrag(event: PointerEvent, kind: 'move' | 'resize', corner?: string) { if (!canEdit.value || locked.value) return; const point = stagePoint(event); if (!point) return; dragging.value = { pointerId: event.pointerId, kind, corner, startX: point.x, startY: point.y, crop: { ...crop.value } }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); event.stopPropagation() }
function onStagePointerMove(event: PointerEvent) { if (tool.value === 'mosaic') { paint(event); return }; const state = dragging.value; if (!state || state.pointerId !== event.pointerId) return; const point = stagePoint(event); if (!point) return; const dx = point.x - state.startX; const dy = point.y - state.startY; if (state.kind === 'move') crop.value = clampCrop({ ...state.crop, x: state.crop.x + dx, y: state.crop.y + dy }); else { const c = state.crop; const left = state.corner?.includes('w'); const top = state.corner?.includes('n'); crop.value = clampCrop({ x: left ? c.x + dx : c.x, y: top ? c.y + dy : c.y, width: c.width + (left ? -dx : dx), height: c.height + (top ? -dy : dy) }) } }
function onStagePointerUp(event: PointerEvent) { if (mosaicPointerId.value === event.pointerId) mosaicPointerId.value = null; if (dragging.value?.pointerId === event.pointerId) dragging.value = null }
function resetEdits() { crop.value = initialCrop(); strokes.value = []; tool.value = 'crop' }
async function confirm() { if (!props.file || locked.value) return; busy.value = true; error.value = ''; try { const processed = await processImage(props.file, { mode: mode.value, outputSize: props.outputSize, crop: crop.value, mosaic: strokes.value }); emit('confirm', processed.blob); await nextTick() } catch { error.value = '无法处理这张图片' } finally { busy.value = false } }
</script>

<template>
  <Teleport to="body"><div v-if="file" class="image-editor__overlay" @click.self="!locked && emit('cancel')"><section class="image-editor" role="dialog" aria-modal="true" :aria-label="title">
    <div class="image-editor__header"><div><h2>{{ title }}</h2><span>{{ file.name }}</span></div><WinButton Style="SubtleButtonStyle" :IsEnabled="!locked" @click="emit('cancel')">关闭</WinButton></div>
    <p v-if="gif" class="image-editor__note">GIF 保留动画，只能预览并按原图上传。</p>
    <div v-if="gif" class="image-editor__gif-stage"><img class="image-editor__gif" :src="gifPreviewUrl" alt="GIF 预览" /></div>
    <div v-else class="image-editor__stage" :style="stageStyle" :class="{ 'is-mosaic': tool === 'mosaic' }" @pointerdown="onStagePointerDown" @pointermove="onStagePointerMove" @pointerup="onStagePointerUp" @pointercancel="onStagePointerUp">
      <canvas ref="canvas" class="image-editor__canvas" />
      <template v-if="tool === 'crop'"><div class="image-editor__mask image-editor__mask--top" :style="{ height: `${crop.y * 100}%` }" /><div class="image-editor__mask image-editor__mask--bottom" :style="{ top: `${(crop.y + crop.height) * 100}%` }" /><div class="image-editor__mask image-editor__mask--left" :style="{ top: `${crop.y * 100}%`, width: `${crop.x * 100}%`, height: `${crop.height * 100}%` }" /><div class="image-editor__mask image-editor__mask--right" :style="{ top: `${crop.y * 100}%`, left: `${(crop.x + crop.width) * 100}%`, height: `${crop.height * 100}%` }" /><div class="image-editor__crop-box" :style="{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }" @pointerdown="beginCropDrag($event, 'move')"><i v-for="corner in ['nw', 'ne', 'sw', 'se']" :key="corner" class="image-editor__handle" :class="`is-${corner}`" @pointerdown="beginCropDrag($event, 'resize', corner)" /></div></template>
    </div>
    <div v-if="canEdit" class="image-editor__tools"><span class="image-editor__crop-label">{{ cropLabel || (cropRatio ? `预设 ${cropRatio}:1` : '自由裁剪') }}</span><WinButton :Style="tool === 'crop' ? 'AccentButtonStyle' : 'DefaultButtonStyle'" :IsEnabled="!locked" @click="tool = 'crop'">裁剪</WinButton><WinButton :Style="tool === 'mosaic' ? 'AccentButtonStyle' : 'DefaultButtonStyle'" :IsEnabled="!locked" @click="tool = 'mosaic'">打马赛克</WinButton><WinButton Style="SubtleButtonStyle" :IsEnabled="!locked" @click="resetEdits">重置</WinButton><div class="image-editor__format" role="radiogroup" aria-label="格式"><button v-for="option in FORMAT_OPTIONS" :key="option.Value" type="button" :class="{ selected: mode === option.Value }" :aria-checked="mode === option.Value" role="radio" @click="mode = option.Value">{{ option.Text }}</button></div></div>
    <p v-if="error" class="field__error">{{ error }}</p><div class="image-editor__actions"><WinButton Style="SubtleButtonStyle" :IsEnabled="!locked" @click="emit('cancel')">取消</WinButton><WinButton Style="AccentButtonStyle" :IsEnabled="!locked" @click="confirm">{{ locked ? '处理中或上传中…' : '确认并上传' }}</WinButton></div>
  </section></div></Teleport>
</template>

<style scoped>
.image-editor__overlay { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 1rem; background: var(--overlay-scrim); }.image-editor { width: min(100%, 760px); max-height: calc(100vh - 2rem); overflow: auto; display: flex; flex-direction: column; gap: .75rem; padding: 1.1rem; border: 1px solid var(--card-stroke); border-radius: var(--radius-md); background: var(--flyout-bg, var(--layer-default)); box-shadow: var(--shadow-dialog); }.image-editor__header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }.image-editor__header h2,.image-editor__note { margin: 0; }.image-editor__header span,.image-editor__note { color: var(--text-secondary); font-size: .85rem; }
.image-editor__stage,.image-editor__gif-stage { position: relative; width: min(100%, 640px); align-self: center; overflow: visible; background: var(--ctrl-fill-secondary); border-radius: var(--radius-sm); }.image-editor__canvas,.image-editor__gif { display: block; width: 100%; height: 100%; object-fit: fill; border-radius: inherit; }.image-editor__stage.is-mosaic { cursor: crosshair; touch-action: none; }.image-editor__mask { position: absolute; z-index: 1; background: rgb(0 0 0 / 55%); pointer-events: none; }.image-editor__mask--top { inset: 0 0 auto; }.image-editor__mask--bottom { right: 0; bottom: 0; left: 0; }.image-editor__mask--left { left: 0; }.image-editor__mask--right { right: 0; }.image-editor__crop-box { position: absolute; z-index: 2; border: 2px solid var(--accent, #60cdff); box-shadow: 0 0 0 1px rgb(0 0 0 / 45%); cursor: move; touch-action: none; }.image-editor__handle { position: absolute; width: 12px; height: 12px; border: 2px solid white; border-radius: 2px; background: var(--accent, #60cdff); }.image-editor__handle.is-nw { top: -7px; left: -7px; cursor: nwse-resize; }.image-editor__handle.is-ne { top: -7px; right: -7px; cursor: nesw-resize; }.image-editor__handle.is-sw { bottom: -7px; left: -7px; cursor: nesw-resize; }.image-editor__handle.is-se { right: -7px; bottom: -7px; cursor: nwse-resize; }.image-editor__tools { display: flex; flex-wrap: wrap; gap: .55rem; align-items: center; }.image-editor__crop-label { color: var(--text-secondary); font-size: .85rem; }.image-editor__format { display: inline-flex; overflow: hidden; border: 1px solid var(--card-stroke); border-radius: var(--radius-sm); }.image-editor__format button { padding: .35rem .7rem; border: 0; color: var(--text-secondary); background: transparent; cursor: pointer; }.image-editor__format button.selected { color: var(--text-primary); background: var(--accent-fill-secondary, rgb(96 205 255 / 20%)); }.image-editor__actions { display: flex; justify-content: flex-end; gap: .6rem; }
@media (max-width: 520px) { .image-editor__overlay { padding: .5rem; }.image-editor { max-height: calc(100vh - 1rem); padding: .8rem; }.image-editor__stage,.image-editor__gif-stage { max-width: 100%; max-height: 46vh; }.image-editor__tools { gap: .35rem; }.image-editor__crop-label { flex-basis: 100%; } }
</style>
