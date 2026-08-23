import { describe, expect, it } from 'vitest'

import nodeRail from '../web/src/components/NodeRail.vue?raw'
import directoryModal from '../web/src/components/DirectoryModal.vue?raw'

describe('据点导轨公开大厅入口', () => {
  it('将左侧 OMEW logo 暴露为可访问的公开据点大厅按钮', () => {
    expect(nodeRail).toMatch(/<button[\s\S]*class="node-rail__logo"[\s\S]*aria-label="[^\"]*公开据点大厅[^\"]*"[\s\S]*@click="showDirectory = true"/)
    expect(nodeRail).toContain('<DirectoryModal :open="showDirectory" @close="showDirectory = false" />')
  })

  it('保留发现与创建据点入口', () => {
    expect(nodeRail).toContain('title="发现据点"')
    expect(nodeRail).toContain('title="创建据点"')
  })

  it('导轨在桌面端位于 shell 左侧，并保留移动端横向布局', () => {
    expect(nodeRail).toContain('border-right: 1px solid var(--stroke-divider)')
    expect(nodeRail).toContain('flex-direction: row;')
    expect(nodeRail).toContain('overflow-x: auto;')
  })

  it('公开据点大厅左侧优先展示据点 logo，缺失时才显示首字占位', () => {
    expect(directoryModal).toContain('<img v-if="entry.avatar" class="directory-entry__cover" :src="entry.avatar" :alt="entry.name" />')
    expect(directoryModal).toContain('v-else class="directory-entry__cover directory-entry__cover--placeholder"')
    expect(directoryModal).not.toContain('entry.cover')
  })
})
