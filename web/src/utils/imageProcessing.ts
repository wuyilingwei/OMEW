export type ImageOutputMode = 'smart' | 'original'

export interface CropRect { x: number; y: number; width: number; height: number }

export interface ProcessedImage { blob: Blob; mime: string; preservedOriginal: boolean; webpFallback: boolean; isGif: boolean }

/** x/y are normalized source-image coordinates; radius may be pixels or normalized. */
export interface MosaicStroke { x: number; y: number; radius: number }

export interface ImageProcessOptions { mode: ImageOutputMode; crop?: CropRect; outputSize?: number; mosaic?: MosaicStroke[] }

const GIF_HEADER = /^(GIF87a|GIF89a)$/
const ENCODABLE_SOURCE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_STATIC_EDGE = 2048
const MIN_CROP_SIZE = 0.01

export async function isGif(file: Blob): Promise<boolean> {
  if (file.type === 'image/gif') return true
  const header = new Uint8Array(await file.slice(0, 6).arrayBuffer())
  return GIF_HEADER.test(String.fromCharCode(...header))
}

export async function filterImageFiles(files: Iterable<File>): Promise<{ accepted: File[]; rejected: number }> {
  const candidates = [...files]
  const accepted = await Promise.all(candidates.map(async (file) => (file.type.startsWith('image/') || await isGif(file)) ? file : null))
  return { accepted: accepted.filter((file): file is File => file !== null), rejected: candidates.length - accepted.filter(Boolean).length }
}

export function createFreeCropRect(): CropRect { return { x: 0, y: 0, width: 1, height: 1 } }

/** Creates a centered crop preset. The ratio is width / height in source pixels. */
export function createCropPreset(aspectRatio: number, sourceAspect = 1): CropRect {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0 || !Number.isFinite(sourceAspect) || sourceAspect <= 0) return createFreeCropRect()
  const normalizedRatio = aspectRatio / sourceAspect
  let width = 1; let height = 1 / normalizedRatio
  if (height > 1) { height = 1; width = aspectRatio }
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height }
}

/** Clamps a rectangle and, when supplied, keeps its width/height ratio. */
export function constrainCropRect(rect: CropRect, aspectRatio?: number, sourceAspect = 1): CropRect {
  let normalized = normalizeCropRect(rect)
  if (!Number.isFinite(aspectRatio) || !aspectRatio || aspectRatio <= 0 || !Number.isFinite(sourceAspect) || sourceAspect <= 0) return normalized
  const ratio = aspectRatio / sourceAspect
  let width = normalized.width; let height = normalized.height
  if (width / height > ratio) width = height * ratio
  else height = width / ratio
  if (width > 1) { width = 1; height = width / ratio }
  if (height > 1) { height = 1; width = height * ratio }
  normalized = { x: Math.min(Math.max(normalized.x, 0), 1 - width), y: Math.min(Math.max(normalized.y, 0), 1 - height), width, height }
  return normalizeCropRect(normalized)
}

export function normalizeCropRect(rect: CropRect): CropRect {
  let x = Number.isFinite(rect.x) ? rect.x : 0; let y = Number.isFinite(rect.y) ? rect.y : 0
  let width = Number.isFinite(rect.width) ? rect.width : 1; let height = Number.isFinite(rect.height) ? rect.height : 1
  if (width < 0) { x += width; width = -width }
  if (height < 0) { y += height; height = -height }
  width = Math.min(1, Math.max(MIN_CROP_SIZE, width)); height = Math.min(1, Math.max(MIN_CROP_SIZE, height))
  x = Math.min(Math.max(0, x), 1 - width); y = Math.min(Math.max(0, y), 1 - height)
  return { x, y, width, height }
}

export function hasMeaningfulCrop(rect?: CropRect): boolean {
  return rect ? !isFullCrop(normalizeCropRect(rect)) : false
}

export function drawCrop(image: CanvasImageSource, width: number, height: number, crop: CropRect): HTMLCanvasElement {
  const sourceWidth = image instanceof HTMLImageElement ? image.naturalWidth : (image as HTMLCanvasElement).width
  const sourceHeight = image instanceof HTMLImageElement ? image.naturalHeight : (image as HTMLCanvasElement).height
  const normalized = normalizeCropRect(crop)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, normalized.x * sourceWidth, normalized.y * sourceHeight, normalized.width * sourceWidth, normalized.height * sourceHeight, 0, 0, canvas.width, canvas.height)
  return canvas
}

export function automaticOutputMime(sourceMime: string, supportsWebp: boolean): string {
  if (supportsWebp && ENCODABLE_SOURCE_MIMES.has(sourceMime)) return 'image/webp'
  return sourceMime === 'image/jpeg' ? 'image/jpeg' : 'image/png'
}

/** Applies strokes in source-image coordinates. Call before cropping. */
export function applyMosaic(canvas: HTMLCanvasElement, strokes: MosaicStroke[] = []): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE')
  for (const stroke of strokes) {
    const radius = stroke.radius <= 1
      ? Math.max(4, Math.round(stroke.radius * Math.min(canvas.width, canvas.height)))
      : Math.max(4, Math.round(stroke.radius))
    const x = Math.round(Math.max(0, Math.min(1, stroke.x)) * canvas.width)
    const y = Math.round(Math.max(0, Math.min(1, stroke.y)) * canvas.height)
    const left = Math.max(0, x - radius)
    const top = Math.max(0, y - radius)
    const regionWidth = Math.min(canvas.width - left, radius * 2)
    const regionHeight = Math.min(canvas.height - top, radius * 2)
    if (regionWidth <= 0 || regionHeight <= 0) continue
    const sample = document.createElement('canvas')
    sample.width = Math.max(1, Math.ceil(regionWidth / 12))
    sample.height = Math.max(1, Math.ceil(regionHeight / 12))
    const sampleCtx = sample.getContext('2d')
    if (!sampleCtx) continue
    sampleCtx.drawImage(canvas, left, top, regionWidth, regionHeight, 0, 0, sample.width, sample.height)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(sample, 0, 0, sample.width, sample.height, left, top, regionWidth, regionHeight)
    ctx.imageSmoothingEnabled = true
  }
}

export async function processImage(file: File, options: ImageProcessOptions): Promise<ProcessedImage> {
  if (await isGif(file)) {
    const blob = file.type === 'image/gif' ? file : new Blob([file], { type: 'image/gif' })
    return { blob, mime: 'image/gif', preservedOriginal: true, webpFallback: false, isGif: true }
  }
  const crop = options.crop ? normalizeCropRect(options.crop) : createFreeCropRect()
  const edited = hasMeaningfulCrop(crop) || Boolean(options.mosaic?.length)
  if (options.mode === 'original' && !edited) return { blob: file, mime: file.type || 'application/octet-stream', preservedOriginal: true, webpFallback: false, isGif: false }
  const image = await loadImage(file)
  const maxEdge = options.outputSize ?? MAX_STATIC_EDGE
  const source = drawContain(image, scaledDimensions(image, MAX_STATIC_EDGE))
  applyMosaic(source, options.mosaic)
  const cropPixels = { width: source.width * crop.width, height: source.height * crop.height }
  const scale = Math.min(1, maxEdge / Math.max(cropPixels.width, cropPixels.height))
  const canvas = drawCrop(source, cropPixels.width * scale, cropPixels.height * scale, crop)
  const requestedMime = outputMime(options.mode, file.type)
  const encoded = await canvasToBlob(canvas, requestedMime)
  return { blob: encoded, mime: encoded.type, preservedOriginal: false, webpFallback: options.mode === 'smart' && encoded.type !== requestedMime, isGif: false }
}

export async function previewImage(file: File, options: Omit<ImageProcessOptions, 'mode'>): Promise<HTMLCanvasElement | null> {
  if (await isGif(file)) return null
  const image = await loadImage(file)
  const crop = options.crop ? normalizeCropRect(options.crop) : createFreeCropRect()
  const maxEdge = options.outputSize ?? MAX_STATIC_EDGE
  const source = drawContain(image, scaledDimensions(image, MAX_STATIC_EDGE))
  applyMosaic(source, options.mosaic)
  const cropPixels = { width: source.width * crop.width, height: source.height * crop.height }
  const scale = Math.min(1, maxEdge / Math.max(cropPixels.width, cropPixels.height))
  return drawCrop(source, cropPixels.width * scale, cropPixels.height * scale, crop)
}

function isFullCrop(crop: CropRect): boolean {
  return crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1
}

function outputMime(mode: ImageOutputMode, sourceMime: string): string {
  return mode === 'smart' ? automaticOutputMime(sourceMime, supportsWebpEncoding()) : sourceEncodingMime(sourceMime)
}

function supportsWebpEncoding(): boolean {
  try {
    return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    return false
  }
}

function scaledDimensions(image: HTMLImageElement, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
  return {
    width: Math.max(1, Math.round(image.naturalWidth * scale)),
    height: Math.max(1, Math.round(image.naturalHeight * scale)),
  }
}

function drawContain(image: HTMLImageElement, dimensions: { width: number; height: number }): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, dimensions.width, dimensions.height)
  return canvas
}

function sourceEncodingMime(mime: string): string {
  return ENCODABLE_SOURCE_MIMES.has(mime) ? mime : 'image/png'
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('IMAGE_ENCODE_FAILED')), mime, 0.9))
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('IMAGE_DECODE_FAILED')) }
    image.src = url
  })
}
