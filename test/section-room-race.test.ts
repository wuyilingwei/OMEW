import { describe, expect, it } from 'vitest'
import { canCommitPostPage } from '../web/src/utils/postLoad'
import sectionRoomSource from '../web/src/composables/useSectionRoom.ts?raw'

describe('section post list request fencing', () => {
  it('rejects a response from an older room generation', () => {
    expect(canCommitPostPage(2, 'node/next', 1, 'node/previous')).toBe(false)
  })

  it('rejects a response after returning to a room with a newer generation', () => {
    expect(canCommitPostPage(3, 'node/posts', 1, 'node/posts')).toBe(false)
  })

  it('accepts only the current room request', () => {
    expect(canCommitPostPage(4, 'node/posts', 4, 'node/posts')).toBe(true)
  })

  it('fences both page commits and loading completion in the section room flow', () => {
    expect(sectionRoomSource).toContain('if (!canCommitPostPage(loadGeneration, loadKey, expectedGeneration, expectedKey)) return')
    expect(sectionRoomSource).toContain(
      'if (canCommitPostPage(loadGeneration, loadKey, expectedGeneration, expectedKey)) postsLoading.value = false',
    )
  })
})
