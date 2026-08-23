import { describe, expect, it } from 'vitest'
import clientSource from '../web/src/api/client.ts?raw'
import typesSource from '../web/src/api/types.ts?raw'
import settingsSource from '../web/src/components/PersonalSettingsModal.vue?raw'
import uploaderSource from '../web/src/components/PersonalCoverUploader.vue?raw'

describe('personal cover web contract', () => {
  it('projects and persists cover in the auth user shape', () => {
    expect(typesSource).toContain('cover: string | null')
    expect(settingsSource).toContain('auth.updateUser({ cover: nextCover })')
  })

  it('uses the dedicated cover endpoints and a wide crop preset', () => {
    expect(clientSource).toContain("uploadBlob<CoverUploadResult>('/api/me/cover'")
    expect(clientSource).toContain("request<{ cover: null }>('/api/me/cover', { method: 'DELETE'")
    expect(uploaderSource).toContain('crop-label="封面 3:1"')
    expect(uploaderSource).toContain(':crop-ratio="3"')
  })
})
