import { describe, expect, it } from 'vitest'
import chatRoomSource from '../web/src/composables/useChatRoom.ts?raw'
import chatPaneSource from '../web/src/components/ChatPane.vue?raw'
import imageEditorSource from '../web/src/components/ImageEditor.vue?raw'
import composePostSource from '../web/src/components/ComposePostModal.vue?raw'
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

  it('previews animated GIFs with a revocable object URL and uses the WinUI format selector in automatic mode', () => {
    expect(imageEditorSource).toContain('const gifPreviewUrl = ref(\'\')')
    expect(imageEditorSource).toContain('URL.createObjectURL(file)')
    expect(imageEditorSource).toContain('URL.revokeObjectURL(gifPreviewUrl.value)')
    expect(imageEditorSource).toContain('<img v-if="gif" class="image-editor__gif" :src="gifPreviewUrl"')
    expect(imageEditorSource).toContain('WinComboBox')
    expect(imageEditorSource).toContain('SelectedValuePath="Value"')
    expect(imageEditorSource).toContain('v-model:SelectedValue="mode"')
    expect(imageEditorSource).toContain("const mode = ref<ImageOutputMode>('auto')")
    expect(imageEditorSource).toContain("mode.value = 'auto'")
  })

  it('keeps the editor locked through parent uploads and restores byte-sniffed GIF selection in chat and posts', () => {
    expect(imageEditorSource).toContain('uploading?: boolean')
    expect(imageEditorSource).toContain('const locked = computed(() => busy.value || props.uploading)')
    expect(imageEditorSource).toContain(':IsEnabled="!locked"')
    expect(chatPaneSource).toContain('filterImageFiles')
    expect(composePostSource).toContain('filterImageFiles')
    expect(chatPaneSource).toContain(':uploading="attachments.uploading.value"')
    expect(composePostSource).toContain(':uploading="attachments.uploading.value"')
  })

  it('sends every selected chat image as its own item instead of one combined media array', () => {
    expect(chatRoomSource).toContain('for (const attachment of media ?? [])')
    expect(chatRoomSource).toContain("sendEntry('', [attachment])")
  })
})
