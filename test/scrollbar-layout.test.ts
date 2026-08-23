import { describe, expect, it } from 'vitest'
import { nativeScrollbarFeatures, nativeScrollbarSurfaces } from '../web/src/style/scrollbar-contract'

describe('Fluent native scrollbar contract', () => {
  it('covers app-owned scrolling surfaces without vendored rails', () => {
    expect(nativeScrollbarSurfaces).toContain('.chat-pane__messages')
    expect(nativeScrollbarSurfaces).toContain('.directory-modal__scroll')
    expect(nativeScrollbarSurfaces).toContain('.image-editor')
    expect(nativeScrollbarSurfaces).not.toContain('.win-scroll-viewer')
  })

  it('requires Firefox, WebKit, interaction, and stable-gutter primitives', () => {
    expect(nativeScrollbarFeatures.firefox).toEqual(['scrollbar-width: thin', 'scrollbar-color'])
    expect(nativeScrollbarFeatures.webkit).toContain('::-webkit-scrollbar-thumb:hover')
    expect(nativeScrollbarFeatures.webkit).toContain('::-webkit-scrollbar-thumb:active')
    expect(nativeScrollbarFeatures.stableGutter).toBe('scrollbar-gutter: stable')
  })
})
