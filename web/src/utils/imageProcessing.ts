export type ImageOutputMode = 'webp' | 'original'

export interface SquareCrop {
  zoom: number
  panX: number
  panY: number
}

export interface ProcessedImage {
  blob: Blob
  mime: string
  preservedOriginal: boolean
  webpFallback: boolean
  isGif: boolean
}

export interface ImageProcessOptions {
  mode: ImageOutputMode
  crop?: SquareCrop
  outputSize?: number
}

const GIF_HEADER = /^(GIF87a|GIF89a)$/
const ENCODABLE_SOURCE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_STATIC_EDGE = 2048

export async function isGif(file: Blob): Promise<boolean> {
  if (file.type === 'image/gif') return true
  const header = new Uint8Array(await file.slice(0, 6).arrayBuffer())
  return GIF_HEADER.test(String.fromCharCode(...header))
}

export function drawSquareCrop(image: CanvasImageSource, width: number, height: number, crop: SquareCrop): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE')
  const naturalWidth = image instanceof HTMLImageElement ? image.naturalWidth : width
  const naturalHeight = image instanceof HTMLImageElement ? image.naturalHeight : height
  const scale = Math.max(width / naturalWidth, height / naturalHeight) * crop.zoom
  const drawnWidth = naturalWidth * scale
  const drawnHeight = naturalHeight * scale
  const x = (width - drawnWidth) / 2 + ((drawnWidth - width) / 2) * crop.panX
  const y = (height - drawnHeight) / 2 + ((drawnHeight - height) / 2) * crop.panY
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, x, y, drawnWidth, drawnHeight)
  return canvas
}

export async function processImage(file: File, options: ImageProcessOptions): Promise<ProcessedImage> {
  if (await isGif(file)) {
    const blob = file.type === 'image/gif' ? file : new Blob([file], { type: 'image/gif' })
    return { blob, mime: 'image/gif', preservedOriginal: true, webpFallback: false, isGif: true }
  }
  if (options.mode === 'original' && !options.crop) {
    return { blob: file, mime: file.type || 'application/octet-stream', preservedOriginal: true, webpFallback: false, isGif: false }
  }

  const image = await loadImage(file)
  const size = options.outputSize ?? Math.min(Math.max(image.naturalWidth, image.naturalHeight), MAX_STATIC_EDGE)
  const canvas = options.crop
    ? drawSquareCrop(image, size, size, options.crop)
    : drawContain(image, scaledDimensions(image, size))
  const requestedMime = options.mode === 'webp' ? 'image/webp' : sourceEncodingMime(file.type)
  const encoded = await canvasToBlob(canvas, requestedMime)
  if (options.mode === 'webp' && encoded.type !== 'image/webp') {
    return { blob: encoded, mime: encoded.type, preservedOriginal: false, webpFallback: true, isGif: false }
  }
  return { blob: encoded, mime: encoded.type, preservedOriginal: false, webpFallback: false, isGif: false }
}

function scaledDimensions(image: HTMLImageElement, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
  return { width: Math.max(1, Math.round(image.naturalWidth * scale)), height: Math.max(1, Math.round(image.naturalHeight * scale)) }
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
