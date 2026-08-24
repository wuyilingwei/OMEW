import { ref, watch } from 'vue'
import { transformGifForPlayback, type GifPlaybackMode } from '../utils/gifPlayback'

export type { GifPlaybackMode } from '../utils/gifPlayback'

const STORAGE_KEY = 'openmew-gif-playback'

const stored = localStorage.getItem(STORAGE_KEY)
const mode = ref<GifPlaybackMode>(stored === 'disabled' || stored === 'once' ? stored : 'normal')

interface ImageState {
  originalSrc: string
  appliedSrc: string | null
  requestId: number
}

const imageStates = new WeakMap<HTMLImageElement, ImageState>()
const transformedUrls = new Map<string, Promise<string | null>>()
let observer: MutationObserver | null = null

function mayBeGif(src: string): boolean {
  if (!src) return false
  if (src.startsWith('data:')) return src.startsWith('data:image/gif')
  if (src.startsWith('blob:')) return true
  try {
    const url = new URL(src, location.href)
    if (/\.(?:avif|bmp|jpe?g|png|svg|webp)$/i.test(url.pathname)) return false
    return url.pathname.startsWith('/media/') || /\.gif$/i.test(url.pathname) || !/\.[a-z0-9]{2,5}$/i.test(url.pathname)
  } catch {
    return /\.gif(?:$|[?#])/i.test(src)
  }
}

async function createTransformedUrl(src: string, playbackMode: Exclude<GifPlaybackMode, 'normal'>): Promise<string | null> {
  try {
    const url = new URL(src, location.href)
    const response = await fetch(src, {
      cache: 'force-cache',
      credentials: url.origin === location.origin ? 'same-origin' : 'omit',
    })
    if (!response.ok) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    const transformed = transformGifForPlayback(bytes, playbackMode)
    if (!transformed) return null
    const blobBytes = new ArrayBuffer(transformed.byteLength)
    new Uint8Array(blobBytes).set(transformed)
    return URL.createObjectURL(new Blob([blobBytes], { type: 'image/gif' }))
  } catch {
    return null
  }
}

function transformedUrl(src: string, playbackMode: Exclude<GifPlaybackMode, 'normal'>): Promise<string | null> {
  const cacheKey = `${playbackMode}:${src}`
  const cached = transformedUrls.get(cacheKey)
  if (cached) return cached
  const pending = createTransformedUrl(src, playbackMode)
  transformedUrls.set(cacheKey, pending)
  return pending
}

function stateFor(image: HTMLImageElement): ImageState {
  const currentSrc = image.getAttribute('src') ?? ''
  const existing = imageStates.get(image)
  if (!existing) {
    const created = { originalSrc: currentSrc, appliedSrc: null, requestId: 0 }
    imageStates.set(image, created)
    return created
  }
  if (currentSrc !== existing.appliedSrc && currentSrc !== existing.originalSrc) {
    existing.originalSrc = currentSrc
    existing.appliedSrc = null
  }
  return existing
}

async function applyToImage(image: HTMLImageElement): Promise<void> {
  const state = stateFor(image)
  const requestId = ++state.requestId

  if (mode.value === 'normal') {
    if (state.appliedSrc && image.getAttribute('src') === state.appliedSrc) image.setAttribute('src', state.originalSrc)
    state.appliedSrc = null
    delete image.dataset.gifPlaybackState
    return
  }

  if (!mayBeGif(state.originalSrc)) {
    delete image.dataset.gifPlaybackState
    return
  }

  const playbackMode = mode.value
  image.dataset.gifPlaybackState = 'loading'
  const nextSrc = await transformedUrl(state.originalSrc, playbackMode)
  if (state.requestId !== requestId || mode.value !== playbackMode || !image.isConnected) return

  if (!nextSrc) {
    image.dataset.gifPlaybackState = 'unavailable'
    return
  }
  state.appliedSrc = nextSrc
  image.dataset.gifPlaybackState = playbackMode
  image.setAttribute('src', nextSrc)
}

function applyToAllImages(): void {
  document.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => void applyToImage(image))
}

export function installGifPlaybackPolicy(): void {
  if (observer) return
  document.documentElement.dataset.gifPlayback = mode.value
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLImageElement) {
        const state = imageStates.get(mutation.target)
        if (state?.appliedSrc === mutation.target.getAttribute('src')) continue
        void applyToImage(mutation.target)
        continue
      }
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue
        if (node instanceof HTMLImageElement && node.hasAttribute('src')) void applyToImage(node)
        node.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => void applyToImage(image))
      }
    }
  })
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
  applyToAllImages()
}

watch(mode, (nextMode) => {
  localStorage.setItem(STORAGE_KEY, mode.value)
  document.documentElement.dataset.gifPlayback = nextMode
  if (observer) applyToAllImages()
})

function setMode(nextMode: GifPlaybackMode): void {
  mode.value = nextMode
}

export function useGifPlayback() {
  return { mode, setMode }
}
