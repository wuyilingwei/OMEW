import { describe, expect, it } from 'vitest'

import rightColumn from '../web/src/components/RightColumn.vue?raw'

describe('right sidebar personal cover and member space', () => {
  it('shows the authenticated user cover instead of the stronghold cover', () => {
    expect(rightColumn).toContain('class="right-column__personal-card"')
    expect(rightColumn).toContain('auth.user.value?.cover')
    expect(rightColumn).toContain('aria-label="个人资料封面"')
    expect(rightColumn).not.toContain('right-column__stronghold')
  })

  it('places the member roster after the action buttons in the remaining space', () => {
    expect(rightColumn.indexOf('class="right-column__actions"')).toBeLessThan(rightColumn.indexOf('<StrongholdMemberRoster />'))
    expect(rightColumn).toMatch(/\.right-column\s*\{[\s\S]*?overflow: hidden;/)
    expect(rightColumn).toContain('class="right-column__personal-cover-placeholder"')
  })
})
