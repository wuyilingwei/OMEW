<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api } from '../api'
import type {
  AdminInstanceConfig,
  AdminUserEntry,
  Emote,
  EmotePack,
  InviteCode,
  MemberGroupRef,
  RootRequirement,
  ServerGroup,
  ServerRole,
  StrongholdApplication,
  StrongholdCreationPolicy,
} from '../api/types'
import { useAuth } from '../composables/useAuth'
import { useStorageUsage } from '../composables/useStorageUsage'
import { fileUploadError } from '../utils/validate'
import { WinButton, WinInfoBar } from '../vendor/winui'
import GroupEditorModal from './GroupEditorModal.vue'

// Server-level administration only (m0-protocol §7.9/§7.10) - instance
// policy, server member appointment, invite codes, stronghold creation
// review, instance emote packs. Deliberately holds nothing stronghold-scoped
// (task 039 split: StrongholdPanel is the sibling, per-stronghold panel).
defineEmits<{ close: [] }>()

const auth = useAuth()

const ROOT_REQUIREMENT_LABEL: Record<RootRequirement, string> = { email: '邮箱', phone: '手机号', code: '邀请码' }
const CREATION_POLICY_LABEL: Record<StrongholdCreationPolicy, string> = { open: '开放', restricted: '限制', application: '申请制' }

// ---- instance policy (read-only, task 035: env-config) -----------------------

const policyLoading = ref(true)
const policyError = ref('')
const config = ref<AdminInstanceConfig | null>(null)

async function loadConfig() {
  if (!auth.token.value) return
  policyLoading.value = true
  policyError.value = ''
  try {
    config.value = await api.getAdminConfig(auth.token.value)
  } catch {
    policyError.value = '无法加载实例政策'
  } finally {
    policyLoading.value = false
  }
}

// ---- server member appointment (task 035/039, server_owner only) -------------

const users = ref<AdminUserEntry[]>([])
const usersLoading = ref(false)
const usersError = ref('')
const usersCursor = ref<string | null>(null)
const roleChangingLocalpart = ref('')

async function loadUsers(reset = true) {
  if (!auth.token.value || !auth.isServerOwner.value) return
  usersLoading.value = true
  usersError.value = ''
  try {
    const page = await api.getAdminUsers(auth.token.value, reset ? undefined : (usersCursor.value ?? undefined))
    users.value = reset ? page.users : [...users.value, ...page.users]
    usersCursor.value = page.next_cursor
  } catch {
    usersError.value = '无法加载用户列表'
  } finally {
    usersLoading.value = false
  }
}

async function setUserRole(user: AdminUserEntry, role: Extract<ServerRole, 'admin' | 'user'>) {
  if (!auth.token.value || roleChangingLocalpart.value) return
  usersError.value = ''
  roleChangingLocalpart.value = user.localpart
  try {
    await api.patchAdminUserRole(auth.token.value, user.localpart, role)
    user.server_role = role
  } catch {
    usersError.value = '操作失败，请稍后重试'
  } finally {
    roleChangingLocalpart.value = ''
  }
}

// ---- server-level user groups (task 048, m0-protocol §7.10a) -----------------

const groups = ref<ServerGroup[]>([])
const groupsLoading = ref(false)
const groupsError = ref('')
const groupEditorOpen = ref(false)
const editingGroup = ref<ServerGroup | null>(null)
const memberGroups = ref<Record<string, MemberGroupRef[]>>({})

async function loadGroups() {
  if (!auth.token.value) return
  groupsLoading.value = true
  groupsError.value = ''
  try {
    groups.value = await api.getServerGroups(auth.token.value)
    void loadMemberGroupBadges()
  } catch {
    groupsError.value = '加载用户组失败'
  } finally {
    groupsLoading.value = false
  }
}

async function loadMemberGroupBadges() {
  if (!auth.token.value || users.value.length === 0) return
  try {
    memberGroups.value = await api.getMemberGroups(
      auth.token.value,
      users.value.map((u) => u.localpart),
    )
  } catch {
    // badges are secondary to the roster itself - fail silently
  }
}

function openCreateGroup() {
  editingGroup.value = null
  groupEditorOpen.value = true
}

function openEditGroup(group: ServerGroup) {
  editingGroup.value = group
  groupEditorOpen.value = true
}

function onGroupSaved() {
  void loadGroups()
}

async function deleteGroupConfirm(group: ServerGroup) {
  if (!auth.token.value) return
  if (!confirm(`删除用户组「${group.name}」？成员会保留，但会失去这个组带来的权限与徽章。`)) return
  groupsError.value = ''
  try {
    await api.deleteServerGroup(auth.token.value, group.id)
    await loadGroups()
  } catch {
    groupsError.value = '删除失败，请稍后重试'
  }
}

async function moveGroup(index: number, direction: -1 | 1) {
  if (!auth.token.value) return
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= groups.value.length) return
  const reordered = [...groups.value]
  const tmp = reordered[index]!
  reordered[index] = reordered[targetIndex]!
  reordered[targetIndex] = tmp
  groupsError.value = ''
  try {
    groups.value = await api.reorderServerGroups(
      auth.token.value,
      reordered.map((g, i) => ({ id: g.id, position: i })),
    )
  } catch {
    groupsError.value = '排序失败，请稍后重试'
  }
}

function hasGroup(localpart: string, groupId: string): boolean {
  return memberGroups.value[localpart]?.some((g) => g.id === groupId) ?? false
}

const pendingAssignment = ref('')

async function toggleUserGroup(user: AdminUserEntry, group: ServerGroup, assign: boolean) {
  if (!auth.token.value || pendingAssignment.value) return
  const key = `${user.localpart}:${group.id}`
  pendingAssignment.value = key
  groupsError.value = ''
  try {
    if (assign) {
      await api.addUserToServerGroup(auth.token.value, group.id, user.localpart)
    } else {
      await api.removeUserFromServerGroup(auth.token.value, group.id, user.localpart)
    }
    await loadMemberGroupBadges()
  } catch {
    groupsError.value = '操作失败，请稍后重试'
  } finally {
    pendingAssignment.value = ''
  }
}

// ---- invite codes --------------------------------------------------------------

const inviteCodes = ref<InviteCode[]>([])
const inviteCount = ref(1)
const inviteBusy = ref(false)
const inviteError = ref('')

async function loadInviteCodes() {
  if (!auth.token.value) return
  try {
    inviteCodes.value = await api.listInviteCodes(auth.token.value)
  } catch {
    // non-fatal — the invite list is secondary to the rest of this panel
  }
}

async function generateInviteCodes() {
  if (!auth.token.value) return
  inviteError.value = ''
  inviteBusy.value = true
  try {
    inviteCodes.value = await api.createInviteCodes(auth.token.value, inviteCount.value)
  } catch {
    inviteError.value = '生成失败，请稍后重试'
  } finally {
    inviteBusy.value = false
  }
}

// ---- stronghold creation applications -------------------------------------------

const pendingApplications = ref<StrongholdApplication[]>([])
const applicationsError = ref('')
const decidingId = ref('')
const approvedNotice = ref('')

async function loadPendingApplications() {
  if (!auth.token.value) return
  applicationsError.value = ''
  try {
    pendingApplications.value = await api.getAdminStrongholdApplications(auth.token.value, 'pending')
  } catch {
    applicationsError.value = '无法加载待审申请'
  }
}

async function decideApplication(id: string, state: 'approved' | 'rejected') {
  if (!auth.token.value || decidingId.value) return
  decidingId.value = id
  approvedNotice.value = ''
  try {
    await api.decideStrongholdApplication(auth.token.value, id, state)
    if (state === 'approved') approvedNotice.value = '已批准，据点已创建'
    await loadPendingApplications()
  } catch {
    applicationsError.value = '操作失败，请稍后重试'
  } finally {
    decidingId.value = ''
  }
}

// ---- instance emote packs (018 admin endpoints) ---------------------------------

const packs = ref<EmotePack[]>([])
const packsError = ref('')
const newPackName = ref('')
const packBusy = ref(false)
const newEmoteName = reactive<Record<string, string>>({})
const emoteUploading = reactive<Record<string, boolean>>({})
const { usage: storage } = useStorageUsage()

async function loadPacks() {
  if (!auth.token.value) return
  try {
    packs.value = await api.getEmotes(auth.token.value)
  } catch {
    packsError.value = '无法加载表情包列表'
  }
}

async function createPack() {
  if (!auth.token.value || packBusy.value) return
  packsError.value = ''
  const name = newPackName.value.trim()
  if (!name || name.length > 32 || name.includes(':')) {
    packsError.value = '表情包名称需为 1-32 字，且不能包含冒号'
    return
  }
  packBusy.value = true
  try {
    await api.createEmotePack(auth.token.value, name)
    newPackName.value = ''
    await loadPacks()
  } catch {
    packsError.value = '创建失败，请稍后重试'
  } finally {
    packBusy.value = false
  }
}

async function deletePack(pack: EmotePack) {
  if (!auth.token.value) return
  if (!confirm(`删除表情包「${pack.name}」？包内所有表情将一并移除。`)) return
  packsError.value = ''
  try {
    await api.deleteEmotePack(auth.token.value, pack.id)
    await loadPacks()
  } catch {
    packsError.value = '删除失败，请稍后重试'
  }
}

async function addEmote(pack: EmotePack, file: File) {
  if (!auth.token.value || emoteUploading[pack.id]) return
  const name = (newEmoteName[pack.id] ?? '').trim()
  if (!name || name.length > 32 || name.includes(':')) {
    packsError.value = '表情名称需为 1-32 字，且不能包含冒号'
    return
  }
  const preflight = fileUploadError(file, storage.value)
  if (preflight) {
    packsError.value = preflight
    return
  }
  packsError.value = ''
  emoteUploading[pack.id] = true
  try {
    const uploaded = await api.uploadMedia(auth.token.value, file)
    await api.createEmote(auth.token.value, pack.id, name, uploaded.id)
    newEmoteName[pack.id] = ''
    await loadPacks()
  } catch {
    packsError.value = '添加失败，请稍后重试'
  } finally {
    emoteUploading[pack.id] = false
  }
}

function onEmoteFileChange(pack: EmotePack, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) void addEmote(pack, file)
  input.value = ''
}

async function deleteEmote(emote: Emote) {
  if (!auth.token.value) return
  packsError.value = ''
  try {
    await api.deleteEmote(auth.token.value, emote.id)
    await loadPacks()
  } catch {
    packsError.value = '删除失败，请稍后重试'
  }
}

onMounted(() => {
  loadConfig().then(() => {
    if (config.value?.stronghold_creation_policy === 'application') void loadPendingApplications()
  })
  loadInviteCodes()
  loadPacks()
  if (auth.isAdmin.value) void loadGroups()
  if (auth.isServerOwner.value) void loadUsers().then(loadMemberGroupBadges)
})
</script>

<template>
  <div class="server-admin">
    <div class="server-admin__header">
      <WinButton Style="SubtleButtonStyle" @Click="$emit('close')">返回</WinButton>
      <h1 class="server-admin__title">服务器管理</h1>
    </div>

    <div v-if="policyLoading" class="server-admin__loading">正在加载…</div>
    <WinInfoBar v-else-if="policyError" :IsOpen="true" :IsClosable="false" :IsIconVisible="false" Severity="Error">
      {{ policyError }}
    </WinInfoBar>

    <div v-else class="server-admin__body">
      <section class="admin-card">
        <h2 class="admin-card__title">实例政策</h2>
        <WinInfoBar :IsOpen="true" :IsClosable="false" :IsIconVisible="false" Severity="Informational">
          政策由服务器部署配置控制，如需修改请联系服务器运维人员。
        </WinInfoBar>
        <dl v-if="config" class="policy-summary">
          <dt>根节点（开放注册）</dt>
          <dd>{{ config.allow_root ? '已开启' : '已关闭' }}</dd>
          <dt>注册门槛</dt>
          <dd>{{ config.root_requirements.length ? config.root_requirements.map((r) => ROOT_REQUIREMENT_LABEL[r]).join('、') : '无' }}</dd>
          <dt>信任身份服务器</dt>
          <dd>{{ config.trusted_identity_servers.join('、') || '无' }}</dd>
          <dt>联邦对等实例</dt>
          <dd>{{ config.federation_peers.join('、') || '无' }}</dd>
          <dt>建据点策略</dt>
          <dd>{{ CREATION_POLICY_LABEL[config.stronghold_creation_policy] }}</dd>
          <dt v-if="config.stronghold_creation_policy === 'restricted'">允许建点的用户</dt>
          <dd v-if="config.stronghold_creation_policy === 'restricted'">{{ config.stronghold_creators.join('、') || '无' }}</dd>
          <dt>游客浏览</dt>
          <dd>{{ config.allow_guest_browsing ? '已开启' : '已关闭' }}</dd>
        </dl>
      </section>

      <section v-if="auth.isServerOwner.value" class="admin-card">
        <h2 class="admin-card__title">服务器成员</h2>
        <p class="field__hint">任免服务器管理员（server_admin）。领主身份唯一且不可通过此处转移。</p>
        <p v-if="usersError" class="field__error">{{ usersError }}</p>
        <ul v-if="users.length" class="user-list">
          <li v-for="user in users" :key="user.localpart" class="user-row">
            <span class="user-row__name">{{ user.localpart }}</span>
            <span class="user-row__role" :class="`user-row__role--${user.server_role}`">{{ user.server_role }}</span>
            <span class="user-row__date">{{ new Date(user.created_at).toLocaleDateString() }}</span>
            <div class="user-row__actions">
              <WinButton
                v-if="user.server_role === 'user'"
                Style="SubtleButtonStyle"
                :IsEnabled="!roleChangingLocalpart"
                @Click="setUserRole(user, 'admin')"
              >
                设为管理员
              </WinButton>
              <WinButton
                v-else-if="user.server_role === 'admin'"
                Style="SubtleButtonStyle"
                :IsEnabled="!roleChangingLocalpart"
                @Click="setUserRole(user, 'user')"
              >
                撤销管理员
              </WinButton>
              <span v-else class="field__hint">领主</span>
            </div>
            <div v-if="groups.length" class="user-row__groups">
              <label v-for="group in groups" :key="group.id" class="user-row__group-checkbox">
                <input
                  type="checkbox"
                  :checked="hasGroup(user.localpart, group.id)"
                  :disabled="pendingAssignment === `${user.localpart}:${group.id}`"
                  @change="toggleUserGroup(user, group, ($event.target as HTMLInputElement).checked)"
                />
                <span class="user-row__group-dot" :style="{ backgroundColor: group.color ?? 'var(--ctrl-fill-tertiary)' }" />
                {{ group.name }}
              </label>
            </div>
          </li>
        </ul>
        <p v-else-if="!usersLoading" class="field__hint">暂无用户</p>
        <WinButton v-if="usersCursor" Style="DefaultButtonStyle" :IsEnabled="!usersLoading" @Click="loadUsers(false)">
          {{ usersLoading ? '加载中…' : '加载更多' }}
        </WinButton>
      </section>

      <section v-if="auth.isAdmin.value" class="admin-card">
        <h2 class="admin-card__title">用户组</h2>
        <p class="field__hint">服务器级用户组（m0-protocol §7.10a），影响成员在所有据点的合成权限。</p>
        <div class="groups-toolbar">
          <WinButton Style="AccentButtonStyle" @Click="openCreateGroup">建组</WinButton>
        </div>
        <div v-if="groupsLoading" class="server-admin__loading">加载中…</div>
        <WinInfoBar v-else-if="groupsError" :IsOpen="true" :IsClosable="false" :IsIconVisible="false" Severity="Error">
          {{ groupsError }}
        </WinInfoBar>
        <p v-else-if="!groups.length" class="field__hint">暂无用户组</p>
        <ul v-else class="group-list">
          <li v-for="(group, index) in groups" :key="group.id" class="group-row">
            <span class="group-row__dot" :style="{ backgroundColor: group.color ?? 'var(--ctrl-fill-tertiary)' }" />
            <span class="group-row__name">{{ group.name }}</span>
            <span v-if="group.is_moderator" class="group-row__mod-badge">管理员组</span>
            <div class="group-row__actions">
              <WinButton Style="SubtleButtonStyle" :IsEnabled="index > 0" @Click="moveGroup(index, -1)">上移</WinButton>
              <WinButton Style="SubtleButtonStyle" :IsEnabled="index < groups.length - 1" @Click="moveGroup(index, 1)">下移</WinButton>
              <WinButton Style="SubtleButtonStyle" @Click="openEditGroup(group)">编辑</WinButton>
              <WinButton Style="AccentButtonStyle" class="win-btn--danger" @Click="deleteGroupConfirm(group)">删除</WinButton>
            </div>
          </li>
        </ul>
      </section>

      <section class="admin-card">
        <h2 class="admin-card__title">邀请码</h2>
        <div class="admin-invite__controls">
          <div class="field admin-invite__count">
            <label class="field__label" for="invite-count">生成数量</label>
            <input id="invite-count" v-model.number="inviteCount" type="number" min="1" max="50" />
          </div>
          <WinButton Style="DefaultButtonStyle" :IsEnabled="!inviteBusy" @Click="generateInviteCodes">
            {{ inviteBusy ? '生成中…' : '生成邀请码' }}
          </WinButton>
        </div>
        <p v-if="inviteError" class="field__error">{{ inviteError }}</p>

        <ul v-if="inviteCodes.length" class="admin-invite__list">
          <li v-for="invite in inviteCodes" :key="invite.code" class="admin-invite__item">
            <code>{{ invite.code }}</code>
            <span class="admin-invite__status" :class="{ 'admin-invite__status--used': invite.used_by != null }">
              {{ invite.used_by != null ? '已使用' : '未使用' }}
            </span>
          </li>
        </ul>
        <p v-else class="field__hint">暂无邀请码。</p>
      </section>

      <section v-if="config?.stronghold_creation_policy === 'application'" class="admin-card">
        <h2 class="admin-card__title">建点申请审批</h2>
        <p v-if="approvedNotice" class="server-admin__save-ok">{{ approvedNotice }}</p>
        <p v-if="applicationsError" class="field__error">{{ applicationsError }}</p>
        <p v-if="!pendingApplications.length" class="field__hint">暂无待审申请</p>
        <ul v-else class="admin-applications__list">
          <li v-for="app in pendingApplications" :key="app.id" class="admin-applications__item">
            <div class="admin-applications__meta">
              <span class="admin-applications__name">{{ app.name }}</span>
              <span class="admin-applications__actor">{{ app.actor }}</span>
              <p v-if="app.description" class="admin-applications__desc">{{ app.description }}</p>
            </div>
            <div class="admin-applications__actions">
              <WinButton Style="AccentButtonStyle" :IsEnabled="!decidingId" @Click="decideApplication(app.id, 'approved')">
                批准
              </WinButton>
              <WinButton Style="SubtleButtonStyle" :IsEnabled="!decidingId" @Click="decideApplication(app.id, 'rejected')">
                拒绝
              </WinButton>
            </div>
          </li>
        </ul>
      </section>

      <section class="admin-card">
        <h2 class="admin-card__title">实例表情包</h2>
        <p v-if="packsError" class="field__error">{{ packsError }}</p>
        <div class="admin-pack__create">
          <input v-model="newPackName" type="text" maxlength="32" placeholder="新表情包名称" />
          <WinButton Style="DefaultButtonStyle" :IsEnabled="!packBusy" @Click="createPack">
            {{ packBusy ? '创建中…' : '新建表情包' }}
          </WinButton>
        </div>

        <div v-if="!packs.length" class="field__hint">暂无表情包</div>
        <div v-for="pack in packs" :key="pack.id" class="admin-pack">
          <div class="admin-pack__header">
            <span class="admin-pack__name">{{ pack.display ?? pack.name }}</span>
            <WinButton Style="SubtleButtonStyle" class="win-btn--danger" @Click="deletePack(pack)">删除表情包</WinButton>
          </div>
          <ul v-if="pack.emotes.length" class="admin-pack__emotes">
            <li v-for="emote in pack.emotes" :key="emote.id" class="admin-pack__emote">
              <img :src="emote.url" :alt="emote.name" class="admin-pack__emote-img" />
              <span class="admin-pack__emote-name">:{{ pack.name }}:{{ emote.name }}:</span>
              <WinButton Style="SubtleButtonStyle" @Click="deleteEmote(emote)">删除</WinButton>
            </li>
          </ul>
          <p v-else class="field__hint">此包暂无表情</p>
          <div class="admin-pack__add">
            <input v-model="newEmoteName[pack.id]" type="text" maxlength="32" placeholder="新表情名称" />
            <label class="admin-pack__upload-btn">
              {{ emoteUploading[pack.id] ? '上传中…' : '选择图片并添加' }}
              <input
                type="file"
                accept="image/*"
                class="admin-pack__file-input"
                :disabled="emoteUploading[pack.id]"
                @change="onEmoteFileChange(pack, $event)"
              />
            </label>
          </div>
        </div>
      </section>
    </div>

    <GroupEditorModal :open="groupEditorOpen" :group="editingGroup" @close="groupEditorOpen = false" @saved="onGroupSaved" />
  </div>
</template>

<style scoped>
.server-admin {
  height: 100%;
  overflow-y: auto;
  padding: 1.5rem 1.5rem 2rem;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.server-admin__header {
  width: 100%;
  max-width: 640px;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.server-admin__title {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--text-primary);
}

.server-admin__loading {
  color: var(--text-tertiary);
  font-size: 0.85rem;
}

.server-admin__body {
  width: 100%;
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.server-admin__save-ok {
  margin: 0;
  font-size: 0.8rem;
  color: var(--SystemFillColorSuccessBrush);
}

.admin-card {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1.1rem 1.25rem;
  border-radius: var(--radius-md);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
}

.admin-card__title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
}

.policy-summary {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.35rem 1rem;
  font-size: 0.82rem;
}

.policy-summary dt {
  color: var(--text-tertiary);
}

.policy-summary dd {
  margin: 0;
  color: var(--text-primary);
  word-break: break-word;
}

.user-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.user-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.7rem;
  border-radius: var(--radius-xs);
  background: var(--ctrl-fill-secondary);
}

.user-row__name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.user-row__role {
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 600;
  background: var(--ctrl-fill-tertiary);
  color: var(--text-secondary);
}

.user-row__role--owner {
  background: rgb(var(--colors-primary));
  color: var(--on-accent);
}

.user-row__role--admin {
  background: rgb(var(--colors-primary) / 0.16);
  color: rgb(var(--colors-primary));
}

.user-row__date {
  font-size: 0.72rem;
  color: var(--text-tertiary);
}

.user-row__actions {
  margin-left: auto;
}

.user-row__groups {
  flex-basis: 100%;
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 0.3rem;
}

.user-row__group-checkbox {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.user-row__group-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.groups-toolbar {
  display: flex;
  justify-content: flex-end;
}

.group-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.group-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.85rem;
  border-radius: var(--radius-sm);
  background: var(--ctrl-fill-secondary);
}

.group-row__dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.group-row__name {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-primary);
}

.group-row__mod-badge {
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: rgb(var(--colors-primary) / 0.16);
  color: rgb(var(--colors-primary));
  font-size: 0.68rem;
  font-weight: 600;
}

.group-row__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-left: auto;
}

.admin-applications__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.admin-applications__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.6rem 0.75rem;
  border-radius: var(--radius-xs);
  background: var(--ctrl-fill-secondary);
}

.admin-applications__meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.admin-applications__name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.admin-applications__actor {
  font-size: 0.72rem;
  color: var(--text-tertiary);
}

.admin-applications__desc {
  margin: 0.2rem 0 0;
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.admin-applications__actions {
  display: flex;
  gap: 0.4rem;
  flex: 0 0 auto;
}

.admin-invite__controls {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
}

.admin-invite__count {
  max-width: 120px;
}

.admin-invite__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.admin-invite__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.45rem 0.6rem;
  border-radius: var(--radius-xs);
  background: var(--ctrl-fill-secondary);
  font-size: 0.82rem;
}

.admin-invite__status {
  color: var(--text-tertiary);
}

.admin-invite__status--used {
  color: var(--SystemFillColorCriticalBrush);
}

.admin-pack__create {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.admin-pack__create input,
.admin-pack__add input {
  flex: 1 1 160px;
  min-width: 0;
  padding: 0.5rem 0.7rem;
  border-radius: var(--radius-xs);
  border: 1px solid var(--ctrl-border);
  background: var(--ctrl-fill-secondary);
  color: var(--text-primary);
  font: inherit;
}

.admin-pack {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--stroke-divider);
}

.admin-pack__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.admin-pack__name {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-primary);
}

.admin-pack__emotes {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.admin-pack__emote {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.5rem;
  border-radius: var(--radius-xs);
  background: var(--ctrl-fill-secondary);
}

.admin-pack__emote-img {
  width: 28px;
  height: 28px;
  object-fit: contain;
  flex: 0 0 auto;
}

.admin-pack__emote-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.78rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-pack__add {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
}

.admin-pack__upload-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 0.5rem 0.9rem;
  border-radius: var(--radius-xs);
  background: var(--ctrl-fill-tertiary);
  color: var(--text-primary);
  font-size: 0.82rem;
  cursor: pointer;
}

.admin-pack__file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
