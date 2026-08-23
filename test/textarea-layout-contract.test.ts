import { describe, expect, it } from 'vitest'
import composePostSource from '../web/src/components/ComposePostModal.vue?raw'
import createStrongholdSource from '../web/src/components/CreateStrongholdCard.vue?raw'
import strongholdAdminSource from '../web/src/components/StrongholdAdminModal.vue?raw'

describe('textarea layout contract', () => {
  it('marks post and description fields as fixed-size textareas', () => {
    expect(composePostSource).toMatch(/<textarea[^>]+v-model="form\.text"[^>]+class="field__textarea--fixed"/)
    expect(createStrongholdSource).toMatch(/<textarea[^>]+id="cs-desc"[^>]+class="field__textarea--fixed"/)
    expect(strongholdAdminSource).toMatch(/<textarea[^>]+id="sh-desc"[^>]+class="field__textarea--fixed"/)
  })
})
