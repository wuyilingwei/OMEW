import { describe, expect, it } from 'vitest'
import leftColumnSource from '../web/src/components/LeftColumn.vue?raw'

describe('topic group button layout contract', () => {
  it('renders every section as an explicit horizontally scrollable tab button', () => {
    expect(leftColumnSource).toContain('<span class="left-column__section-title">话题组</span>')
    expect(leftColumnSource).toContain('v-for="(room, index) in sectionRooms"')
    expect(leftColumnSource).toContain('role="tablist"')
    expect(leftColumnSource).toContain('role="tab"')
    expect(leftColumnSource).toContain('<span class="left-column__section-hash" aria-hidden="true">#</span>')
    expect(leftColumnSource).toContain('overflow-x: auto')
    expect(leftColumnSource).toContain(":Style=\"selectedSection?.id === room.id ? 'AccentButtonStyle' : 'DefaultButtonStyle'\"")
    expect(leftColumnSource).not.toContain('WinDropDownButton')
    expect(leftColumnSource).toMatch(/\.left-column__section-button\s*\{[\s\S]*?width: 3\.5rem;/)
    expect(leftColumnSource).toMatch(/\.left-column__section-button\s*\{[\s\S]*?height: 3\.5rem;/)
    expect(leftColumnSource).toMatch(/\.left-column__section-button\s*\{[\s\S]*?border-radius: 0\.25rem;/)
    expect(leftColumnSource).toMatch(/\.left-column__section-button\s*\{[\s\S]*?flex-direction: column;/)
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

  it('keeps the topic group controls outside the post-feed scroll area', () => {
    expect(leftColumnSource).toMatch(/\.left-column\s*\{[\s\S]*?overflow: hidden;/)
    expect(leftColumnSource).toMatch(/\.left-column__feed\s*\{[\s\S]*?flex: 1 1 auto;/)
    expect(leftColumnSource).toMatch(/\.left-column__feed\s*\{[\s\S]*?min-height: 0;/)
    expect(leftColumnSource).toMatch(/\.left-column__feed\s*\{[\s\S]*?overflow-y: auto;/)
    expect(leftColumnSource).toMatch(/\.left-column__header\s*\{[\s\S]*?background: var\(--app-bg\);/)
    expect(leftColumnSource).toMatch(/\.left-column__header\s*\{[\s\S]*?border-bottom: 1px solid var\(--stroke-divider\);/)
    expect(leftColumnSource).not.toMatch(/\.left-column__header\s*\{[\s\S]*?position: sticky;/)
  })
})
