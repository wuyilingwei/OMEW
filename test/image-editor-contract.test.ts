import { describe, expect, it } from 'vitest'
import chatRoomSource from '../web/src/composables/useChatRoom.ts?raw'
import chatPaneSource from '../web/src/components/ChatPane.vue?raw'
import { automaticOutputMime, isGif } from '../web/src/utils/imageProcessing'

describe('image editor contract', () => {
  it('uses automatic encoding that prefers modern static formats with a PNG-safe fallback', () => {
    expect(automaticOutputMime('image/jpeg', true)).toBe('image/webp')
    expect(automaticOutputMime('image/png', false)).toBe('image/png')
    expect(automaticOutputMime('image/unknown', true)).toBe('image/png')
  })

  it('recognizes GIF bytes even without a MIME and keeps animations out of canvas editing', async () => {
    const gif = new Blob([Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00])])
    expect(await isGif(gif)).toBe(true)
    expect(chatPaneSource).toContain('ImageEditor')
  })

  it('sends every selected chat image as its own item instead of one combined media array', () => {
    expect(chatRoomSource).toContain('for (const attachment of media ?? [])')
    expect(chatRoomSource).toContain("sendEntry('', [attachment])")
  })
})
