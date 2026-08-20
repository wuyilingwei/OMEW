<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { api } from '../api'
import type { Group, MemberPatch, MemberTab, StrongholdConfigPatch, StrongholdMember } from '../api/types'
import { EMPTY_STATE } from '../assets/mew'
import { useAuth } from '../composables/useAuth'
import { useStorageUsage } from '../composables/useStorageUsage'
import { useStronghold } from '../composables/useStronghold'
import { useStrongholdMembers } from '../composables/useStrongholdMembers'
import { formatBytes, nonNegativeIntError, requiredMaxLengthError } from '../utils/validate'
import { WinButton, WinInfoBar, WinSelectorBar, WinToggleSwitch } from '../vendor/winui'
import AvatarBadge from './AvatarBadge.vue'
import CoverUploader from './CoverUploader.vue'
import EmptyState from './EmptyState.vue'
import GroupEditorModal from './GroupEditorModal.vue'
import MemberInfoCard from './MemberInfoCard.vue'

// stronghold-scoped management only (members / custom groups / stronghold
// settings) - server-level administration (policy, server members, invite
// codes, emote packs) lives in the separate ServerAdminPanel (task 039
// split: the two must not share a component or entry point).
const props = withDefaults(defineProps<{ initialTab?: 'members' | 'groups' | 'settings' }>(), { initialTab: 'members' })
defineEmits<{ close: [] }>()

const auth = useAuth()
const { currentNode, selectedNodeId } = useStronghold()
const { myRole } = useStrongholdMembers()

const ROLE_LABEL: Record<string, string> = { owner: '领主', mod: '管理员', member: '成员' }
const MEMBER_TABS: { Text: string; value: MemberTab }[] = [
  { Text: '全部', value: 'all' },
  { Text: '受限', value: 'restricted' },
  { Text: '黑名单', value: 'banned' },
]

const panelTab = ref<'members' | 'groups' | 'settings'>(props.initialTab)
// m0-protocol §7.10: a server owner/admin manages every stronghold with
// owner-equivalent permission even without a membership row - mirrors the
// server's overlayRole/effectiveRole gate (api.ts), not just the local role.
const canManage = computed(() => myRole.value === 'owner' || myRole.value === 'mod' || auth.isAdmin.value)
const isOwner = computed(() => myRole.value === 'owner')

const panelTabOptions = computed(() => {
  const opts: { Text: string; value: 'members' | 'groups' | 'settings' }[] = [{ Text: '成员列表', value: 'members' }]
  if (canManage.value) {
    opts.push({ Text: '用户组', value: 'groups' })
    opts.push({ Text: '据点设置', value: 'settings' })
  }
  return opts
})
const panelTabSelected = computed(() => panelTabOptions.value.find((o) => o.value === panelTab.value))
function onPanelTabSelect(item: { value: 'members' | 'groups' | 'settings' }) {
  panelTab.value = item.value
}

const memberTabSelected = computed(() => MEMBER_TABS.find((o) => o.value === memberTab.value))
function onMemberTabSelect(item: { value: MemberTab }) {
  memberTab.value = item.value
}

function isSelf(member: StrongholdMember) {
  return member.username === auth.user.value?.username
}

// ---- members tab ----
const memberTab = ref<MemberTab>('all')
const members = ref<StrongholdMember[]>([])
const membersLoading = ref(false)
const membersError = ref('')
const actionError = ref('')
const infoCardMember = ref<StrongholdMember | null>(null)

async function loadMembers() {
  if (!auth.token.value) return
  membersLoading.value = true
  membersError.value = ''
  try {
    const page = await api.getStrongholdMembers(auth.token.value, selectedNodeId.value, memberTab.value)
    members.value = page.members
  } catch {
    membersError.value = '加载成员列表失败'
  } finally {
    membersLoading.value = false
  }
}

watch([memberTab, selectedNodeId], loadMembers, { immediate: true })

async function runAction(action: (token: string) => Promise<unknown>) {
  if (!auth.token.value) return
  actionError.value = ''
  try {
    await action(auth.token.value)
    await loadMembers()
  } catch {
    actionError.value = '操作失败，请稍后重试'
  }
}

function toggleDeny(member: StrongholdMember, field: 'deny_discussion' | 'deny_idea' | 'deny_comment') {
  // the real API's deny is a single bitmask overwrite (not per-bit), so the
  // patch always carries the full current tri-state with just the toggled
  // field flipped - client.ts recombines these three into one deny value.
  const patch: MemberPatch = {
    deny_discussion: member.deny_discussion,
    deny_idea: member.deny_idea,
    deny_comment: member.deny_comment,
    [field]: !member[field],
  }
  runAction((token) => api.patchMember(token, selectedNodeId.value, member.actor, patch))
}

function promote(member: StrongholdMember) {
  runAction((token) => api.patchMember(token, selectedNodeId.value, member.actor, { role: 'mod' }))
}

function demote(member: StrongholdMember) {
  runAction((token) => api.patchMember(token, selectedNodeId.value, member.actor, { role: 'member' }))
}

function kick(member: StrongholdMember) {
  if (!confirm(`将「${member.display_name}」移出据点？此操作可撤销——对方之后可以重新申请加入。`)) return
  runAction((token) => api.removeMember(token, selectedNodeId.value, member.actor))
}

function ban(member: StrongholdMember) {
  if (!confirm(`拉黑「${member.display_name}」？此操作不可撤销——对方将无法再次加入本据点，除非管理员从黑名单手动解除。`)) return
  runAction((token) => api.banMember(token, selectedNodeId.value, member.actor))
}

function unban(member: StrongholdMember) {
  runAction((token) => api.unbanMember(token, selectedNodeId.value, member.actor))
}

function transfer(member: StrongholdMember) {
  if (!confirm(`将领主权限转让给「${member.display_name}」？转让后你将不再拥有该据点的管理权限。`)) return
  runAction((token) => api.transferOwnership(token, selectedNodeId.value, member.actor))
}

// ---- groups tab (task 037/039) ----
const groups = ref<Group[]>([])
const groupsLoading = ref(false)
const groupsError = ref('')
const groupEditorOpen = ref(false)
const editingGroup = ref<Group | null>(null)

async function loadGroups() {
  if (!auth.token.value || !canManage.value) return
  groupsLoading.value = true
  groupsError.value = ''
  try {
    groups.value = await api.getGroups(auth.token.value, selectedNodeId.value)
  } catch {
    groupsError.value = '加载用户组失败'
  } finally {
    groupsLoading.value = false
  }
}

// immediate: true matters here - the right column's "用户组" shortcut mounts
// this panel with initialTab='groups' directly, so the tab is already
// 'groups' on the very first run with no prior value to change from.
watch(
  [panelTab, selectedNodeId],
  ([tab]) => {
    if (tab === 'groups') void loadGroups()
  },
  { immediate: true },
)

// member counts read off the currently-loaded "all" members roster - accurate
// as long as the member sub-tab hasn't been switched away from "all" since
// the groups tab was opened (no extra always-on fetch just for a headcount).
const groupMemberCount = computed(() => {
  const counts = new Map<string, number>()
  for (const member of members.value) {
    for (const g of member.groups) counts.set(g.id, (counts.get(g.id) ?? 0) + 1)
  }
  return counts
})

function openCreateGroup() {
  editingGroup.value = null
  groupEditorOpen.value = true
}

function openEditGroup(group: Group) {
  editingGroup.value = group
  groupEditorOpen.value = true
}

function onGroupSaved() {
  void loadGroups()
  void loadMembers()
}

async function deleteGroupConfirm(group: Group) {
  if (!auth.token.value) return
  if (!confirm(`删除用户组「${group.name}」？成员会保留，但会失去这个组带来的权限与徽章。`)) return
  groupsError.value = ''
  try {
    await api.deleteGroup(auth.token.value, selectedNodeId.value, group.id)
    await loadGroups()
    await loadMembers()
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
    groups.value = await api.reorderGroups(
      auth.token.value,
      selectedNodeId.value,
      reordered.map((g, i) => ({ id: g.id, position: i })),
    )
  } catch {
    groupsError.value = '排序失败，请稍后重试'
  }
}

// ---- settings tab ----
const settingsLoading = ref(true)
const settingsError = ref('')
const settingsSaving = ref(false)
const settingsSaveOk = ref(false)
const form = reactive({
  name: '',
  description: '',
  cover: '',
  visibility: 'public' as 'public' | 'private',
  allow_message_edit: true,
  allow_message_retract: true,
  edit_window_secs: 300,
})

async function loadSettings() {
  if (!auth.token.value) return
  settingsLoading.value = true
  settingsError.value = ''
  try {
    const config = await api.getStrongholdConfig(auth.token.value, selectedNodeId.value)
    form.name = config.name
    form.description = config.description
    form.cover = config.cover
    form.visibility = config.visibility
    form.allow_message_edit = config.allow_message_edit
    form.allow_message_retract = config.allow_message_retract
    form.edit_window_secs = config.edit_window_secs
  } catch {
    settingsError.value = '无法加载据点设置'
  } finally {
    settingsLoading.value = false
  }
}

watch(selectedNodeId, loadSettings, { immediate: true })

// storage usage: informational only, shown alongside the settings tab so an
// owner/mod can see how much of the instance quota this account has used.
const { usage: storage } = useStorageUsage()

async function saveSettings() {
  if (!auth.token.value) return
  settingsError.value = requiredMaxLengthError(form.name, 32, '名称') || nonNegativeIntError(form.edit_window_secs, '编辑/撤回窗口秒数')
  if (settingsError.value) return
  settingsSaving.value = true
  settingsSaveOk.value = false
  const patch: StrongholdConfigPatch = {
    name: form.name,
    description: form.description,
    cover: form.cover,
    allow_message_edit: form.allow_message_edit,
    allow_message_retract: form.allow_message_retract,
    edit_window_secs: form.edit_window_secs,
  }
  if (isOwner.value) patch.visibility = form.visibility
  try {
    await api.patchStrongholdConfig(auth.token.value, selectedNodeId.value, patch)
    settingsSaveOk.value = true
  } catch {
    settingsError.value = '保存失败，请稍后重试'
  } finally {
    settingsSaving.value = false
  }
}
</script>

<template>
  <div class="stronghold-panel">
    <div class="stronghold-panel__header">
      <WinButton Style="SubtleButtonStyle" @Click="$emit('close')">返回</WinButton>
      <h1 class="stronghold-panel__title">{{ currentNode?.name }}</h1>
    </div>

    <WinSelectorBar
      class="stronghold-panel__tabs"
      :Items="panelTabOptions"
      :SelectedItem="panelTabSelected"
      @update:SelectedItem="onPanelTabSelect"
    />

    <div v-if="panelTab === 'members'" class="stronghold-panel__body">
      <WinSelectorBar
        class="member-subtabs"
        :Items="MEMBER_TABS"
        :SelectedItem="memberTabSelected"
        @update:SelectedItem="onMemberTabSelect"
      />

      <p v-if="actionError" class="field__error">{{ actionError }}</p>
      <div v-if="membersLoading" class="stronghold-panel__loading">加载中…</div>
      <WinInfoBar v-else-if="membersError" :IsOpen="true" :IsClosable="false" :IsIconVisible="false" Severity="Error">
        {{ membersError }}
      </WinInfoBar>
      <EmptyState v-else-if="!members.length" :image="EMPTY_STATE.members" text="暂无成员" />

      <ul v-else class="member-list">
        <li v-for="member in members" :key="member.actor" class="member-row">
          <button type="button" class="member-row__identity" @click="infoCardMember = member">
            <AvatarBadge :seed="member.username" :size="36" />
            <span class="member-row__names">
              <span class="member-row__display-name">{{ member.display_name }}</span>
              <span class="member-row__actor">{{ member.actor }}</span>
              <span v-if="member.groups.length" class="member-row__groups">
                <span v-for="g in member.groups" :key="g.id" class="group-badge">
                  <span class="group-badge__dot" :style="{ backgroundColor: g.color ?? 'var(--ctrl-fill-tertiary)' }" />
                  {{ g.name }}
                </span>
              </span>
            </span>
          </button>
          <span class="member-row__role" :class="`member-row__role--${member.role}`">{{ ROLE_LABEL[member.role] }}</span>

          <template v-if="memberTab !== 'banned'">
            <div class="member-row__deny">
              <WinToggleSwitch
                :modelValue="member.deny_discussion"
                :IsEnabled="canManage && !isSelf(member) && member.role === 'member'"
                @update:modelValue="toggleDeny(member, 'deny_discussion')"
              >
                讨论
              </WinToggleSwitch>
              <WinToggleSwitch
                :modelValue="member.deny_idea"
                :IsEnabled="canManage && !isSelf(member) && member.role === 'member'"
                @update:modelValue="toggleDeny(member, 'deny_idea')"
              >
                想法
              </WinToggleSwitch>
              <WinToggleSwitch
                :modelValue="member.deny_comment"
                :IsEnabled="canManage && !isSelf(member) && member.role === 'member'"
                @update:modelValue="toggleDeny(member, 'deny_comment')"
              >
                评论
              </WinToggleSwitch>
            </div>

            <div v-if="canManage && !isSelf(member) && member.role !== 'owner'" class="member-row__actions">
              <WinButton v-if="isOwner && member.role === 'member'" Style="SubtleButtonStyle" @Click="promote(member)">
                任命管理员
              </WinButton>
              <WinButton v-if="isOwner && member.role === 'mod'" Style="SubtleButtonStyle" @Click="demote(member)">
                撤销管理员
              </WinButton>
              <template v-if="isOwner || member.role !== 'mod'">
                <WinButton Style="SubtleButtonStyle" @Click="kick(member)">踢出</WinButton>
                <WinButton Style="AccentButtonStyle" class="win-btn--danger" @Click="ban(member)">拉黑</WinButton>
              </template>
              <WinButton v-if="isOwner" Style="AccentButtonStyle" class="win-btn--danger" @Click="transfer(member)">
                转让领主
              </WinButton>
            </div>
          </template>

          <div v-else class="member-row__actions">
            <WinButton v-if="canManage" Style="SubtleButtonStyle" @Click="unban(member)">解除拉黑</WinButton>
          </div>
        </li>
      </ul>
    </div>

    <div v-else-if="panelTab === 'groups'" class="stronghold-panel__body">
      <div class="groups-toolbar">
        <WinButton Style="AccentButtonStyle" @Click="openCreateGroup">建组</WinButton>
      </div>

      <div v-if="groupsLoading" class="stronghold-panel__loading">加载中…</div>
      <WinInfoBar v-else-if="groupsError" :IsOpen="true" :IsClosable="false" :IsIconVisible="false" Severity="Error">
        {{ groupsError }}
      </WinInfoBar>
      <EmptyState v-else-if="!groups.length" :image="EMPTY_STATE.members" text="暂无用户组" />

      <ul v-else class="group-list">
        <li v-for="(group, index) in groups" :key="group.id" class="group-row">
          <span class="group-row__dot" :style="{ backgroundColor: group.color ?? 'var(--ctrl-fill-tertiary)' }" />
          <span class="group-row__name">{{ group.name }}</span>
          <span v-if="group.is_moderator" class="group-row__mod-badge">管理员组</span>
          <span class="group-row__count">{{ groupMemberCount.get(group.id) ?? 0 }} 人</span>
          <div class="group-row__actions">
            <WinButton Style="SubtleButtonStyle" :IsEnabled="index > 0" @Click="moveGroup(index, -1)">上移</WinButton>
            <WinButton Style="SubtleButtonStyle" :IsEnabled="index < groups.length - 1" @Click="moveGroup(index, 1)">下移</WinButton>
            <WinButton Style="SubtleButtonStyle" @Click="openEditGroup(group)">编辑</WinButton>
            <WinButton Style="AccentButtonStyle" class="win-btn--danger" @Click="deleteGroupConfirm(group)">删除</WinButton>
          </div>
        </li>
      </ul>
    </div>

    <div v-else class="stronghold-panel__body">
      <div v-if="settingsLoading" class="stronghold-panel__loading">加载中…</div>
      <template v-else>
        <WinInfoBar v-if="settingsError" :IsOpen="true" :IsClosable="false" :IsIconVisible="false" Severity="Error">
          {{ settingsError }}
        </WinInfoBar>

        <div class="field">
          <label class="field__label" for="sh-name">名称</label>
          <input id="sh-name" v-model="form.name" type="text" maxlength="32" />
        </div>
        <div class="field">
          <label class="field__label" for="sh-desc">描述</label>
          <textarea id="sh-desc" v-model="form.description" rows="3"></textarea>
        </div>
        <div class="field">
          <span class="field__label">封面</span>
          <CoverUploader v-if="auth.token.value" v-model="form.cover" :token="auth.token.value" />
        </div>
        <div class="field">
          <label class="field__label" for="sh-visibility">可见性</label>
          <select id="sh-visibility" v-model="form.visibility" :disabled="!isOwner">
            <option value="public">公开</option>
            <option value="private">私密</option>
          </select>
          <p v-if="!isOwner" class="field__hint">仅领主可修改可见性</p>
        </div>
        <WinToggleSwitch v-model="form.allow_message_edit">允许编辑消息</WinToggleSwitch>
        <WinToggleSwitch v-model="form.allow_message_retract">允许撤回消息</WinToggleSwitch>
        <div class="field">
          <label class="field__label" for="sh-window">编辑/撤回窗口（秒，0 表示不限）</label>
          <input id="sh-window" v-model.number="form.edit_window_secs" type="number" min="0" step="1" />
        </div>

        <div class="stronghold-panel__save">
          <p v-if="settingsSaveOk" class="stronghold-panel__save-ok">已保存</p>
          <WinButton Style="AccentButtonStyle" :IsEnabled="!settingsSaving" @Click="saveSettings">
            {{ settingsSaving ? '保存中…' : '保存设置' }}
          </WinButton>
        </div>

        <p v-if="storage" class="stronghold-panel__storage">
          存储用量：{{ formatBytes(storage.used) }} / {{ formatBytes(storage.quota) }}（单文件上限 {{ formatBytes(storage.max_file) }}）
        </p>
      </template>
    </div>

    <MemberInfoCard
      v-if="infoCardMember"
      :member="infoCardMember"
      :can-manage="canManage"
      :groups="groups"
      @close="infoCardMember = null"
      @groups-changed="loadMembers"
    />
    <GroupEditorModal :open="groupEditorOpen" :group="editingGroup" @close="groupEditorOpen = false" @saved="onGroupSaved" />
  </div>
</template>

<style scoped>
.stronghold-panel {
  height: 100%;
  overflow-y: auto;
  padding: 1.5rem 1.5rem 2rem;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stronghold-panel__header {
  width: 100%;
  max-width: 640px;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.stronghold-panel__title {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--text-primary);
}

.stronghold-panel__tabs {
  width: 100%;
  max-width: 640px;
  padding: 0.25rem;
  margin-bottom: 1rem;
  border-radius: var(--radius-sm);
  background: var(--ctrl-fill-secondary);
}

.stronghold-panel__body {
  width: 100%;
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.stronghold-panel__loading {
  color: var(--text-tertiary);
  font-size: 0.85rem;
}

.stronghold-panel__storage {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-tertiary);
}

.member-subtabs {
  margin-bottom: 0.2rem;
}

.member-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.member-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  padding: 0.65rem 0.85rem;
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
}

.member-row__identity {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  min-width: 0;
}

.member-row__names {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.member-row__display-name {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-primary);
}

.member-row__actor {
  font-size: 0.72rem;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-row__groups {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.2rem;
}

.group-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  background: var(--ctrl-fill-tertiary);
  color: var(--text-secondary);
  font-size: 0.68rem;
}

.group-badge__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.member-row__role {
  flex: 0 0 auto;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  background: var(--ctrl-fill-tertiary);
  color: var(--text-secondary);
}

.member-row__role--owner {
  background: rgb(var(--colors-primary));
  color: var(--on-accent);
}

.member-row__role--mod {
  background: rgb(var(--colors-primary) / 0.16);
  color: rgb(var(--colors-primary));
}

.member-row__deny {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  font-size: 0.76rem;
  color: var(--text-secondary);
}

.member-row__deny :deep(.win-switch-root) {
  min-width: 0;
}

.member-row__deny :deep(.win-switch-wrap) {
  gap: 6px;
  min-height: auto;
}

.member-row__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-left: auto;
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
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
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

.group-row__count {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.group-row__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-left: auto;
}

.stronghold-panel__save {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.stronghold-panel__save-ok {
  margin: 0;
  font-size: 0.8rem;
  color: var(--SystemFillColorSuccessBrush);
}
</style>
