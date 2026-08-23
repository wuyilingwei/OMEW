/** Native scrollbar surfaces intentionally exclude the vendored WinScrollViewer. */
export const nativeScrollbarSurfaces = [
  '.left-column', '.right-column', '.node-rail', '.emote-picker', '.image-editor',
  '.auth-modal__scroll', '.compose-modal__scroll', '.group-modal__form',
  '.chat-pane__messages', '.post-modal__scroll', '.personal-modal__scroll',
  '.directory-modal__scroll', '.admin-modal__scroll',
] as const

export const nativeScrollbarFeatures = {
  firefox: ['scrollbar-width: thin', 'scrollbar-color'],
  webkit: ['::-webkit-scrollbar', '::-webkit-scrollbar-thumb:hover', '::-webkit-scrollbar-thumb:active'],
  stableGutter: 'scrollbar-gutter: stable',
} as const
