import { describe, expect, it } from 'vitest'

import roster from '../web/src/components/StrongholdMemberRoster.vue?raw'
import rightColumn from '../web/src/components/RightColumn.vue?raw'

describe('据点成员右栏 roster', () => {
  it('复用成员数据并明确声明没有在线状态来源', () => {
    expect(roster).toContain('useStrongholdMembers')
    expect(roster).toContain('在线状态未提供')
    expect(roster).toContain('member-roster__status-dot')
    expect(roster).toContain('member.display_name')
    expect(roster).toContain('member.avatar')
  })

  it('作为独立组件接入右栏并保留独立滚动容器', () => {
    expect(rightColumn).toContain('<StrongholdMemberRoster />')
    expect(roster).toContain('overflow-y: auto')
  })
})
