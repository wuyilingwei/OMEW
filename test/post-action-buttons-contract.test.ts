import { describe, expect, it } from 'vitest'
import postCardSource from '../web/src/components/PostCard.vue?raw'
import postModalSource from '../web/src/components/PostModal.vue?raw'

describe('post action button contract', () => {
  it('keeps forwarding and reactions available as explicit detail actions', () => {
    expect(postModalSource).toContain('class="post-modal__actions"')
    expect(postModalSource).toContain('aria-label="转发"')
    expect(postModalSource).toContain('aria-label="添加反应"')
    expect(postModalSource).toContain('@click="sharePost"')
    expect(postModalSource).toContain('@click="openReactionPicker"')
    expect(postModalSource).toContain('navigator.share')
    expect(postModalSource).toContain('navigator.clipboard?.writeText')
    expect(postModalSource).toContain('postMenuRef.value?.openAt')
  })

  it('keeps reaction-chip clicks from opening the surrounding post card', () => {
    expect(postCardSource).toContain('class="post-card__reactions" @click.stop')
    expect(postCardSource).toContain('@toggle="emit(\'toggle-reaction\', $event)"')
  })
})
