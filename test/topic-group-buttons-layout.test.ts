import { describe, expect, it } from 'vitest'
import leftColumnSource from '../web/src/components/LeftColumn.vue?raw'

describe('topic group button layout contract', () => {
  it('renders every section as an explicit horizontally scrollable tab button', () => {
    expect(leftColumnSource).toContain('v-for="(room, index) in sectionRooms"')
    expect(leftColumnSource).toContain('role="tablist"')
    expect(leftColumnSource).toContain('role="tab"')
    expect(leftColumnSource).toContain('overflow-x: auto')
    expect(leftColumnSource).toContain(":Style=\"selectedSection?.id === room.id ? 'AccentButtonStyle' : 'DefaultButtonStyle'\"")
    expect(leftColumnSource).not.toContain('WinDropDownButton')
  })

  it('exposes selected state and keyboard navigation without mixing topic labels', () => {
    expect(leftColumnSource).toContain(':aria-selected="selectedSection?.id === room.id"')
    expect(leftColumnSource).toContain(':tabindex="selectedSection?.id === room.id ? 0 : -1"')
    expect(leftColumnSource).toContain("event.key === 'ArrowRight'")
    expect(leftColumnSource).toContain("event.key === 'Home'")
    expect(leftColumnSource).toContain("querySelectorAll<HTMLElement>('[role=\"tab\"]')")
    expect(leftColumnSource).toContain('left-column__section-nav')
    expect(leftColumnSource).toContain('帖子话题组')
  })

  it('keeps the same button UI visible for the empty-group state', () => {
    expect(leftColumnSource).toContain('v-if="!sectionRooms.length"')
    expect(leftColumnSource).toContain('left-column__section-placeholder')
    expect(leftColumnSource).toContain(':IsEnabled="false"')
    expect(leftColumnSource).toContain('aria-label="暂无可用话题组"')
    expect(leftColumnSource).not.toContain('left-column__section-empty')
  })

  it('pins the topic group controls while the post column scrolls', () => {
    expect(leftColumnSource).toMatch(/\.left-column__header\s*\{[\s\S]*?position: sticky;/)
    expect(leftColumnSource).toMatch(/\.left-column__header\s*\{[\s\S]*?top: 0;/)
    expect(leftColumnSource).toMatch(/\.left-column__header\s*\{[\s\S]*?z-index: 2;/)
    expect(leftColumnSource).toMatch(/\.left-column__header\s*\{[\s\S]*?background: var\(--app-bg\);/)
    expect(leftColumnSource).toMatch(/\.left-column__header\s*\{[\s\S]*?border-bottom: 1px solid var\(--stroke-divider\);/)
  })
})
