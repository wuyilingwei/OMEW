import { describe, expect, it } from 'vitest'
import nodeRail from '../web/src/components/NodeRail.vue?raw'

function cssRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = nodeRail.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  expect(match, `missing CSS rule: ${selector}`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('据点图标按钮比例契约', () => {
  it('清零 button padding 并固定为正方形盒模型', () => {
    const rule = cssRule('.node-rail__item')
    expect(rule).toMatch(/width:\s*40px;/)
    expect(rule).toMatch(/height:\s*40px;/)
    expect(rule).toMatch(/aspect-ratio:\s*1;/)
    expect(rule).toMatch(/box-sizing:\s*border-box;/)
    expect(rule).toMatch(/padding:\s*0;/)
    expect(rule).toMatch(/overflow:\s*hidden;/)

    const mobileRule = nodeRail.match(/\.shell__body\[data-view='stronghold'\] \.node-rail__item\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(mobileRule).toMatch(/width:\s*44px;/)
    expect(mobileRule).toMatch(/height:\s*44px;/)
    expect(mobileRule).toMatch(/flex:\s*0 0 auto;/)
    expect(mobileRule).not.toContain('flex-basis')
  })

  it('让据点头像填充按钮并保持裁切比例', () => {
    const rule = cssRule('.node-rail__avatar')
    expect(rule).toMatch(/width:\s*100%;/)
    expect(rule).toMatch(/height:\s*100%;/)
    expect(rule).toMatch(/object-fit:\s*cover;/)
  })

  it('保留 button 的键盘与无障碍语义', () => {
    expect(nodeRail).toContain('<button')
    expect(nodeRail).toContain('type="button"')
    expect(nodeRail).toContain(':aria-label="node.name"')
    expect(nodeRail).toContain('@click="selectNode(node.id)"')
  })

})
