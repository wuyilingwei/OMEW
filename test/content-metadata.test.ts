import { describe, expect, it } from 'vitest'
import type { RoomSummary } from '../web/src/api/types'
import { channelDescription, resolveSectionTarget } from '../web/src/utils/contentMetadata'

const room = (id: string, name: string, type: 'section' | 'channel' = 'section', description: string | null = null): RoomSummary => ({ id, name, type, description })

describe('content metadata', () => {
  it('defaults the composer target to the current section and resolves an explicit selection', () => {
    const sections = [room('posts', '帖子'), room('ideas', '想法')]
    expect(resolveSectionTarget(sections, 'posts')?.id).toBe('posts')
    expect(resolveSectionTarget(sections, 'ideas')?.id).toBe('ideas')
    expect(resolveSectionTarget(sections, 'missing')?.id).toBe('posts')
  })

  it('renders non-empty channel descriptions while treating blank descriptions as absent', () => {
    expect(channelDescription('  规则与公告  ')).toBe('规则与公告')
    expect(channelDescription('   ')).toBe('')
    expect(channelDescription(null)).toBe('')
  })
})
