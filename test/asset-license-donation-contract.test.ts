import { describe, expect, it } from 'vitest'
import terms from '../ASSET-LICENSE.md?raw'
import readme from '../README.md?raw'

describe('asset-license donation boundary', () => {
  it('limits donor recognition to a title or consented identity display', () => {
    expect(terms).toContain('捐助头衔')
    expect(terms).toContain('明确同意公开的身份信息')
    expect(terms).toContain('donor title')
    expect(terms).toContain('expressly consented to make public')
    expect(terms).toContain('不得附带链接、广告、推广文案或其他商业利益')
  })

  it('excludes crowdfunding from the purely voluntary donation exception', () => {
    expect(terms).toContain('众筹（无论是否有回报）')
    expect(terms).toContain('一律不属于本节的纯自愿捐助')
    expect(terms).toContain('crowdfunding (with or without a reward)')
    expect(terms).toContain('never qualify as purely voluntary donations')
    expect(readme).toContain('众筹不属于纯捐助')
  })
})
