import { describe, expect, it } from 'vitest'
import client from '../web/src/api/client.ts?raw'
import mock from '../web/src/api/mock.ts?raw'
import types from '../web/src/api/types.ts?raw'
import serverAdminModal from '../web/src/components/ServerAdminModal.vue?raw'
import strongholdAdminModal from '../web/src/components/StrongholdAdminModal.vue?raw'

describe('global and timed ban web contract', () => {
  it('keeps a shared expiry projection and sends Unix-millisecond expiry payloads', () => {
    expect(types).toMatch(/interface BanEntry[\s\S]*?expires_at: string \| null/)
    expect(client).toMatch(/interface WireBanEntry[\s\S]*?expires_at: number \| null/)
    expect(client).toMatch(/banMember:[\s\S]*?body: JSON\.stringify\(\{ expires_at: expiresAt \}\)/)
    expect(client).toMatch(/banAccountGlobally:[\s\S]*?body: JSON\.stringify\(\{ expires_at: expiresAt \}\)/)
    expect(client).toMatch(/new Date\(entry\.expires_at\)\.toISOString\(\)/)
  })

  it('uses the admin ban REST surface and keeps mock expiry behavior aligned', () => {
    expect(client).toMatch(/listGlobalBans:[\s\S]*?'\/api\/admin\/bans'/)
    expect(client).toMatch(/`\/api\/admin\/bans\/\$\{encodeURIComponent\(actor\)\}`/)
    expect(mock).toMatch(/function activeBans[\s\S]*?Date\.parse\(ban\.expires_at\) > now/)
    expect(mock).toMatch(/operator\.server_role !== 'owner' && target\.server_role !== 'user'/)
  })

  it('separates global and stronghold scope, keeps ordinary users out, and exposes optional automatic unban times', () => {
    expect(serverAdminModal).toMatch(/id="global-ban-expires-at"[\s\S]*?type="datetime-local"/)
    expect(serverAdminModal).toMatch(/全局封禁/)
    expect(serverAdminModal).toMatch(/function canGloballyBan[\s\S]*?user\.server_role !== 'owner'[\s\S]*?auth\.isServerOwner\.value \|\| user\.server_role === 'user'/)
    expect(serverAdminModal).toMatch(/<template v-if="auth\.isAdmin\.value">[\s\S]*?解除全局封禁/)
    expect(strongholdAdminModal).toMatch(/id="stronghold-ban-expires-at"[\s\S]*?type="datetime-local"/)
    expect(strongholdAdminModal).toMatch(/据点级封禁/)
    expect(strongholdAdminModal).toMatch(/canManage && !isSelf\(member\) && member\.role !== 'owner'/)
    expect(strongholdAdminModal).toMatch(/解除据点封禁/)
  })
})
