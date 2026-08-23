import { describe, expect, it } from 'vitest'
import itemContextMenuSource from '../web/src/components/ItemContextMenu.vue?raw'

describe('item context menu layout contract', () => {
  it('uses a three-column reaction grid that narrows to two columns', () => {
    expect(itemContextMenuSource).toContain('grid-template-columns: repeat(3, 32px)')
    expect(itemContextMenuSource).toContain('grid-template-columns: repeat(2, 32px)')
    expect(itemContextMenuSource).toContain('const REACTION_COLUMNS = window.innerWidth <= NARROW_VIEWPORT ? 2 : 3')
    expect(itemContextMenuSource).not.toContain('overflow-x: auto')
  })

  it('keeps edit and retract commands below the reaction grid', () => {
    const reactionGrid = itemContextMenuSource.indexOf('class="item-context-menu__reactions"')
    const editCommand = itemContextMenuSource.indexOf('v-if="canEdit"')
    const retractCommand = itemContextMenuSource.indexOf('v-if="canRetract"')

    expect(reactionGrid).toBeGreaterThan(-1)
    expect(editCommand).toBeGreaterThan(reactionGrid)
    expect(retractCommand).toBeGreaterThan(editCommand)
    expect(itemContextMenuSource).toContain('const reactionRows = Math.ceil(reactionNames.length / REACTION_COLUMNS)')
  })
})
