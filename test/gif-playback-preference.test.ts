import { describe, expect, it } from 'vitest'
import personalSettings from '../web/src/components/PersonalSettingsModal.vue?raw'
import mainSource from '../web/src/main.ts?raw'
import preferenceSource from '../web/src/composables/useGifPlayback.ts?raw'
import { transformGifForPlayback } from '../web/src/utils/gifPlayback'

function animatedGif(loopCount = 0): Uint8Array {
  const ascii = (text: string) => Array.from(new TextEncoder().encode(text))
  return new Uint8Array([
    ...ascii('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff,
    0x21, 0xff, 11, ...ascii('NETSCAPE2.0'), 3, 1, loopCount & 0xff, loopCount >>> 8, 0,
    0x21, 0xf9, 4, 0, 2, 0, 0, 0,
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 1, 0,
    0x21, 0xf9, 4, 0, 2, 0, 0, 0,
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 1, 0,
    0x3b,
  ])
}

function imageDescriptorCount(bytes: Uint8Array): number {
  return bytes.reduce((count, byte) => count + Number(byte === 0x2c), 0)
}

function loopCount(bytes: Uint8Array): number | null {
  const signature = Array.from(new TextEncoder().encode('NETSCAPE2.0'))
  const start = bytes.findIndex((_, index) => signature.every((byte, offset) => bytes[index + offset] === byte))
  if (start < 0) return null
  const subBlock = start + signature.length
  return bytes[subBlock + 2]! | (bytes[subBlock + 3]! << 8)
}

describe('GIF playback preference', () => {
  it('turns an animated GIF into a valid first-frame-only GIF when animations are disabled', () => {
    const transformed = transformGifForPlayback(animatedGif(), 'disabled')

    expect(transformed).not.toBeNull()
    expect(new TextDecoder().decode(transformed!.subarray(0, 6))).toBe('GIF89a')
    expect(imageDescriptorCount(transformed!)).toBe(1)
    expect(transformed!.at(-1)).toBe(0x3b)
  })

  it('removes an infinite GIF loop extension so the browser plays it once', () => {
    const transformed = transformGifForPlayback(animatedGif(0), 'once')

    expect(transformed).not.toBeNull()
    expect(imageDescriptorCount(transformed!)).toBe(2)
    expect(loopCount(transformed!)).toBeNull()
  })

  it('leaves normal playback byte-for-byte unchanged and rejects malformed GIF data', () => {
    const source = animatedGif(0)
    expect(transformGifForPlayback(source, 'normal')).toBe(source)
    expect(transformGifForPlayback(new Uint8Array([1, 2, 3]), 'disabled')).toBeNull()
  })

  it('exposes and persists all three modes from the personal appearance panel', () => {
    expect(personalSettings).toContain('GIF 动画')
    expect(personalSettings).toContain("value: 'disabled'")
    expect(personalSettings).toContain("value: 'once'")
    expect(personalSettings).toContain("value: 'normal'")
    expect(personalSettings).toContain('仅显示第一帧')
    expect(preferenceSource).toContain("const STORAGE_KEY = 'openmew-gif-playback'")
    expect(preferenceSource).toContain("localStorage.setItem(STORAGE_KEY, mode.value)")
    expect(mainSource).toContain('installGifPlaybackPolicy()')
  })
})
