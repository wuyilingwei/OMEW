import { describe, expect, it } from 'vitest'
import leftColumnSource from '../web/src/components/LeftColumn.vue?raw'

describe('topic group button layout contract', () => {
  it('renders every section as an explicit horizontally scrollable tab button', () => {
    expect(leftColumnSource).toContain('v-for="(room, index) in sectionRooms"')
    expect(leftColumnSource).toContain('role="tablist"')
    expect(leftColumnSource).toContain('role="tab"')
    expect(leftColumnSource).toContain('overflow-x: auto')
    expect(leftColumnSource).not.toContain('WinDropDownButton')
  })

  it('exposes selected state and keyboard navigation without mixing topic labels', () => {
    expect(leftColumnSource).toContain(':aria-selected="selectedSection?.id === room.id"')
    expect(leftColumnSource).toContain("event.key === 'ArrowRight'")
    expect(leftColumnSource).toContain("event.key === 'Home'")
    expect(leftColumnSource).toContain("querySelectorAll<HTMLElement>('[role=\"tab\"]')")
    expect(leftColumnSource).toContain('left-column__section-nav')
    expect(leftColumnSource).toContain('帖子话题组')
  })

  it('keeps the single-group and empty-group states visible', () => {
    expect(leftColumnSource).toContain('v-if="!sectionRooms.length"')
    expect(leftColumnSource).toContain('class="left-column__section-empty"')
  })
})
