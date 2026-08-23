import { describe, expect, it } from 'vitest'
import postCardSource from '../web/src/components/PostCard.vue?raw'
import postModalSource from '../web/src/components/PostModal.vue?raw'

describe('post action button contract', () => {
  it('keeps forwarding and reactions available as explicit post actions', () => {
    const source = `${postCardSource}\n${postModalSource}`

    expect(source).toMatch(/WinButton/)
    expect(source).toMatch(/转发/)
    expect(source).toMatch(/反应|ReactionChips|add-reaction|toggle-reaction/)
    expect(source).toMatch(/@(?:click|Click)(?:\.stop)?=['"][^'"]*(?:forward|repost|转发)/)
  })

  it('prevents action clicks from opening the surrounding post card', () => {
    expect(postCardSource).toMatch(/(?:转发|forward|repost)[\s\S]{0,300}@click\.stop/)
    expect(postCardSource).toMatch(/(?:反应|reaction|ReactionChips)[\s\S]{0,300}@click\.stop/)
  })
})
