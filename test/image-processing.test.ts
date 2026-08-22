import { describe, expect, it } from 'vitest'
import { isGif } from '../web/src/utils/imageProcessing'
import { fileUploadError } from '../web/src/utils/validate'

describe('client image processing guards', () => {
  it('recognizes GIF bytes even when the browser omitted the MIME, preserving animation upstream', async () => {
    const gif = new Blob([Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00])])
    expect(await isGif(gif)).toBe(true)
  })

  it('checks the final processed blob, not an earlier source file size', () => {
    const finalBlob = new Blob([new Uint8Array(64)], { type: 'image/webp' })
    expect(fileUploadError(finalBlob, { used: 100, quota: 1_000, max_file: 128 })).toBe('')
  })
})
