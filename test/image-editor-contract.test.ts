import { describe, expect, it } from 'vitest'
import chatRoomSource from '../web/src/composables/useChatRoom.ts?raw'
import chatPaneSource from '../web/src/components/ChatPane.vue?raw'
import serverAdminSource from '../web/src/components/ServerAdminModal.vue?raw'
import avatarUploaderSource from '../web/src/components/StrongholdAvatarUploader.vue?raw'
import coverUploaderSource from '../web/src/components/CoverUploader.vue?raw'
import imageEditorSource from '../web/src/components/ImageEditor.vue?raw'
import composePostSource from '../web/src/components/ComposePostModal.vue?raw'
import { isGif } from '../web/src/utils/imageProcessing'

describe('image editor contract', () => {
  it('recognizes GIF bytes even without a MIME and keeps animations out of canvas editing', async () => {
    const gif = new Blob([Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00])])
    expect(await isGif(gif)).toBe(true)
    expect(chatPaneSource).toContain('ImageEditor')
  })

  it('previews animated GIFs and exposes only smart/original output modes', () => {
    expect(imageEditorSource).toContain('const gifPreviewUrl = ref(\'\')')
    expect(imageEditorSource).toContain('URL.createObjectURL(file)')
    expect(imageEditorSource).toContain('URL.revokeObjectURL(gifPreviewUrl.value)')
    expect(imageEditorSource).toContain('class="image-editor__gif" :src="gifPreviewUrl"')
    expect(imageEditorSource).toContain('image-editor__format')
    expect(imageEditorSource).toContain('role="radiogroup"')
    expect(imageEditorSource).toContain("const mode = ref<ImageOutputMode>('smart')")
    expect(imageEditorSource).toContain("{ Text: '智能', Value: 'smart' }")
    expect(imageEditorSource).toContain("{ Text: '原图', Value: 'original' }")
    expect(imageEditorSource).not.toContain("Value: 'webp'")
    expect(imageEditorSource).not.toContain("Value: 'jpeg'")
    expect(imageEditorSource).not.toContain("Value: 'png'")
    expect(imageEditorSource).not.toContain('WinComboBox')
    expect(imageEditorSource).not.toContain('zoom')
    expect(imageEditorSource).not.toContain('panX')
    expect(imageEditorSource).not.toContain('panY')
    expect(imageEditorSource).toContain('CropRect')
    expect(imageEditorSource).toContain('cropRatio')
  })

  it('keeps free cropping for regular images and sends explicit presets only to covers and avatars', () => {
    expect(imageEditorSource).toContain("cropRatio?: number | null")
    expect(composePostSource).toContain(':crop-ratio="16 / 9"')
    expect(composePostSource).toContain('crop-label="帖子封面 16:9"')
    expect(avatarUploaderSource).toContain('crop-label="头像 1:1"')
    expect(avatarUploaderSource).toContain(':crop-ratio="1"')
    expect(coverUploaderSource).toContain(':crop-ratio="cropRatio"')
    expect(chatPaneSource).toMatch(/<ImageEditor :file="editingImage" :uploading=/)
    expect(composePostSource).toMatch(/<ImageEditor :file="editingImage" :uploading=/)
    expect(serverAdminSource).toMatch(/<ImageEditor :file="emoteEditorFile" :uploading=/)
    expect(coverUploaderSource).toContain('<ImageEditor :file="selectedFile"')
    expect(avatarUploaderSource).toContain('<ImageEditor :file="selectedFile"')
    expect(imageEditorSource).toContain('createCropPreset')
    expect(imageEditorSource).toContain('constrainCropRect')
    expect(imageEditorSource).toContain('mosaicPointerId')
    expect(imageEditorSource).toContain("corner?: CropCorner")
    expect(imageEditorSource).toContain('resizeFreeCrop')
    expect(imageEditorSource).toContain('resizePresetCrop')
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
