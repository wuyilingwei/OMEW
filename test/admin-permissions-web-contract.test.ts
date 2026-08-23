import { describe, expect, it } from 'vitest'
import mockApiSource from '../web/src/api/mock.ts?raw'
import serverAdminModal from '../web/src/components/ServerAdminModal.vue?raw'
import strongholdAdminModal from '../web/src/components/StrongholdAdminModal.vue?raw'

// UI permissions are intentionally a source contract: these checks bind each
// authority to its concrete operation instead of accepting a stray role string
// elsewhere in the component as proof that the operation is correctly gated.
describe('administrator permission UI contract', () => {
  it('lets every server admin load and group users, while reserving role writes for the server owner', () => {
    expect(serverAdminModal).toMatch(/async function loadUsers[\s\S]*?if \(!auth\.token\.value \|\| !auth\.isAdmin\.value\) return/)
    expect(serverAdminModal).toMatch(/async function setUserRole[\s\S]*?if \(!auth\.token\.value \|\| !auth\.isServerOwner\.value \|\| roleChangingLocalpart\.value\) return/)
    expect(serverAdminModal).toMatch(/<template v-if="auth\.isAdmin\.value">[\s\S]*?@change="toggleUserGroup/)
    expect(serverAdminModal).toMatch(/v-if="auth\.isServerOwner\.value && user\.server_role === 'user'"[\s\S]*?@click="setUserRole\(user, 'admin'\)"/)
    expect(serverAdminModal).toMatch(/v-else-if="auth\.isServerOwner\.value && user\.server_role === 'admin'"[\s\S]*?@click="setUserRole\(user, 'user'\)"/)
  })

  it('uses the effective owner overlay for normal management while reserving force-dissolve for the server owner', () => {
    expect(strongholdAdminModal).toMatch(/const hasOwnerOverlay = computed\(\(\) => isOwner\.value \|\| auth\.isAdmin\.value\)/)
    expect(strongholdAdminModal).toMatch(/const canTransferOwnership = computed\(\(\) => isOwner\.value \|\| auth\.isServerOwner\.value\)/)
    expect(strongholdAdminModal).toMatch(/const canManage = computed\(\(\) => myRole\.value === 'owner' \|\| myRole\.value === 'mod' \|\| auth\.isAdmin\.value\)/)
    expect(strongholdAdminModal).toMatch(/if \(canManage\.value\) \{[\s\S]*?value: 'channels'[\s\S]*?value: 'sections'[\s\S]*?value: 'settings'/)
    expect(strongholdAdminModal).toMatch(/:IsEnabled="canManage && !isSelf\(member\) && member\.role === 'member'"/)
    expect(strongholdAdminModal).toMatch(/if \(hasOwnerOverlay\.value\) patch\.visibility = form\.visibility/)
    expect(strongholdAdminModal).toMatch(/:IsEnabled="hasOwnerOverlay"/)
    expect(strongholdAdminModal).toMatch(/v-if="hasOwnerOverlay && member\.role === 'member'"[\s\S]*?@click="promote\(member\)"/)
    expect(strongholdAdminModal).toMatch(/v-if="hasOwnerOverlay && member\.role === 'mod'"[\s\S]*?@click="demote\(member\)"/)
    expect(strongholdAdminModal).toMatch(/v-if="canTransferOwnership"[\s\S]*?@click="transfer\(member\)"/)
    expect(strongholdAdminModal).toMatch(/const canDeleteStronghold = computed\(\(\) => isOwner\.value \|\| auth\.isServerOwner\.value\)/)
    expect(strongholdAdminModal).toMatch(/async function deleteStronghold\(\) \{[\s\S]*?!canDeleteStronghold\.value/)
    expect(strongholdAdminModal).toMatch(/<section v-if="canDeleteStronghold"[\s\S]*?强制解散据点/)
    expect(mockApiSource).toMatch(/if \(!isActualOwner && user\.server_role !== 'owner'\)/)
  })
})
