import { describe, expect, it } from 'vitest'
import leftColumnSource from '../web/src/components/LeftColumn.vue?raw'
import rightColumnSource from '../web/src/components/RightColumn.vue?raw'

describe('layout A stronghold card contract', () => {
  it('places the stronghold cover, avatar, name, and description above the left post feed', () => {
    expect(leftColumnSource).toContain('<div class="left-column__stronghold">')
    expect(leftColumnSource).toContain('class="left-column__cover"')
    expect(leftColumnSource).toContain('class="left-column__avatar"')
    expect(leftColumnSource).toContain('class="left-column__stronghold-name"')
    expect(leftColumnSource).toContain('class="left-column__stronghold-description"')
    expect(leftColumnSource.indexOf('class="left-column__stronghold"')).toBeLessThan(leftColumnSource.indexOf('class="left-column__feed"'))
  })

  it('keeps the always-visible horizontal topic group controls and default post room loader', () => {
    expect(leftColumnSource).toContain('left-column__section-button')
    expect(leftColumnSource).toContain('left-column__section-nav')
    expect(leftColumnSource).toContain('onSectionKeydown')
    expect(leftColumnSource).toContain('left-column__section-placeholder')
    expect(leftColumnSource).toContain('role="tablist"')
    expect(leftColumnSource).toContain("import { useSection } from '../composables/useSection'")
    expect(leftColumnSource).toContain("import { useSectionRoom } from '../composables/useSectionRoom'")
    expect(leftColumnSource).toContain('const { posts, postsLoading, hasMorePosts, loadMorePosts, postRoom, toggleReaction } = useSectionRoom()')
  })

  it('keeps post actions in the left column and leaves the right action area available', () => {
    expect(leftColumnSource).toContain('class="left-column__compose-btn"')
    expect(leftColumnSource).toContain('登录后发帖')
    expect(rightColumnSource).not.toContain('right-column__stronghold')
    expect(rightColumnSource).toContain('class="right-column__actions"')
    expect(rightColumnSource).toContain('个人设置')
  })
})
