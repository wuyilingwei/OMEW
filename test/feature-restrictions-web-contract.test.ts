import { describe, expect, it } from 'vitest'
import client from '../web/src/api/client.ts?raw'
import mock from '../web/src/api/mock.ts?raw'
import types from '../web/src/api/types.ts?raw'
import serverAdminModal from '../web/src/components/ServerAdminModal.vue?raw'
import strongholdAdminModal from '../web/src/components/StrongholdAdminModal.vue?raw'

describe('independent chat and posts restriction web contract', () => {
  it('models owner, server override and effective state for each feature', () => {
    expect(types).toMatch(/type RestrictedFeature = 'chat' \| 'posts'/)
    expect(types).toMatch(/type FeatureRestrictionMode = 'inherit' \| 'force_allow' \| 'force_pause'/)
    expect(types).toMatch(/interface FeatureRestrictions[\s\S]*?chat: FeatureRestrictionState[\s\S]*?posts: FeatureRestrictionState/)
    expect(client).toMatch(/getFeatureRestrictions:[\s\S]*?\/feature-restrictions/)
    expect(client).toMatch(/patchOwnerFeatureRestriction:[\s\S]*?feature-restrictions\/owner[\s\S]*?\{ feature, paused, expires_at: expiresAt \}/)
    expect(client).toMatch(/patchServerFeatureRestriction:[\s\S]*?feature-restrictions\/server[\s\S]*?\{ feature, mode, expires_at: expiresAt \}/)
  })

  it('makes owner pauses and server overrides independent in the mock', () => {
    expect(mock).toMatch(/\['chat', 'posts'\] as const/)
    expect(mock).toMatch(/const serverForced = entry\.server\.mode !== 'inherit'/)
    expect(mock).toMatch(/state\.owner_actor !== user\.actor/)
    expect(mock).toMatch(/async patchServerFeatureRestriction[\s\S]*?requireAdmin\(token\)/)
  })

  it('rejects mock socket writes before appendItem when the matching feature is paused', () => {
    expect(mock).toMatch(/const feature = room\.type === 'channel' \? 'chat' : 'posts'/)
    expect(mock).toMatch(/toFeatureRestrictions\(this\.nodeId\)\[feature\]\.effective\.paused[\s\S]*?OMEW_FEATURE_RESTRICTED[\s\S]*?return true[\s\S]*?const item = appendItem/)
  })

  it('limits owner writes to the actual stronghold owner and server writes to server admins', () => {
    expect(strongholdAdminModal).toMatch(/<template v-if="isOwner">[\s\S]*?saveOwnerFeatureRestriction\(feature\)/)
    expect(strongholdAdminModal).toMatch(/v-if="!isOwner"[\s\S]*?仅据点实际领主可设置据点级暂停/)
    expect(strongholdAdminModal).toMatch(/\['chat', 'posts'\] as RestrictedFeature\[\]/)
    expect(serverAdminModal).toMatch(/v-if="auth\.isAdmin\.value" class="admin-card">[\s\S]*?据点聊天与发帖覆盖/)
    expect(serverAdminModal).toMatch(/\['chat', 'posts'\] as const/)
    expect(serverAdminModal).toMatch(/保存服务器覆盖/)
  })
})
