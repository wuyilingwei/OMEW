<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { api, ApiRequestError } from '../api'
import type { MemberPatch, MemberTab, StrongholdConfigPatch, StrongholdMember } from '../api/types'
import { useAuth } from '../composables/useAuth'
import { useStronghold } from '../composables/useStronghold'
import { useStrongholdMembers } from '../composables/useStrongholdMembers'
import { WinButton } from '../vendor/winui'
import AvatarBadge from './AvatarBadge.vue'
import MemberInfoCard from './MemberInfoCard.vue'

const props = withDefaults(defineProps<{ initialTab?: 'members' | 'settings' }>(), { initialTab: 'members' })
defineEmits<{ close: [] }>()

const auth = useAuth()
const { currentNode, selectedNodeId } = useStronghold()
const { myRole } = useStrongholdMembers()

const ROLE_LABEL: Record<string, string> = { owner: '领主', mod: '管理员', member: '成员' }
const MEMBER_TABS: { value: MemberTab; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'restricted', label: '受限' },
  { value: 'banned', label: '黑名单' },
]

const panelTab = ref<'members' | 'settings'>(props.initialTab)
const canManage = computed(() => myRole.value === 'owner' || myRole.value === 'mod')
const isOwner = computed(() => myRole.value === 'owner')

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
  } catch (err) {
    actionError.value = err instanceof ApiRequestError ? `操作失败：${err.code}` : '操作失败，请稍后重试'
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

async function saveSettings() {
  if (!auth.token.value) return
  settingsSaving.value = true
  settingsSaveOk.value = false
  settingsError.value = ''
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
  } catch (err) {
    settingsError.value = err instanceof ApiRequestError ? `保存失败：${err.code}` : '保存失败，请稍后重试'
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

    <div class="stronghold-panel__tabs">
      <button
        type="button"
        class="stronghold-panel__tab"
        :class="{ 'stronghold-panel__tab--active': panelTab === 'members' }"
        @click="panelTab = 'members'"
      >
        成员列表
      </button>
      <button
        v-if="canManage"
        type="button"
        class="stronghold-panel__tab"
        :class="{ 'stronghold-panel__tab--active': panelTab === 'settings' }"
        @click="panelTab = 'settings'"
      >
        据点设置
      </button>
    </div>

    <div v-if="panelTab === 'members'" class="stronghold-panel__body">
      <div class="member-subtabs">
        <button
          v-for="t in MEMBER_TABS"
          :key="t.value"
          type="button"
          class="member-subtabs__item"
          :class="{ 'member-subtabs__item--active': memberTab === t.value }"
          @click="memberTab = t.value"
        >
          {{ t.label }}
        </button>
      </div>

      <p v-if="actionError" class="field__error">{{ actionError }}</p>
      <div v-if="membersLoading" class="stronghold-panel__loading">加载中…</div>
      <p v-else-if="membersError" class="notice notice--error">{{ membersError }}</p>
      <p v-else-if="!members.length" class="stronghold-panel__empty">暂无成员</p>

      <ul v-else class="member-list">
        <li v-for="member in members" :key="member.actor" class="member-row">
          <button type="button" class="member-row__identity" @click="infoCardMember = member">
            <AvatarBadge :seed="member.username" :size="36" />
            <span class="member-row__names">
              <span class="member-row__display-name">{{ member.display_name }}</span>
              <span class="member-row__actor">{{ member.actor }}</span>
            </span>
          </button>
          <span class="member-row__role" :class="`member-row__role--${member.role}`">{{ ROLE_LABEL[member.role] }}</span>

          <template v-if="memberTab !== 'banned'">
            <div class="member-row__deny">
              <label class="member-row__deny-item">
                <input
                  type="checkbox"
                  :checked="member.deny_discussion"
                  :disabled="!canManage || isSelf(member) || member.role !== 'member'"
                  @change="toggleDeny(member, 'deny_discussion')"
                />
                讨论
              </label>
              <label class="member-row__deny-item">
                <input
                  type="checkbox"
                  :checked="member.deny_idea"
                  :disabled="!canManage || isSelf(member) || member.role !== 'member'"
                  @change="toggleDeny(member, 'deny_idea')"
                />
                想法
              </label>
              <label class="member-row__deny-item">
                <input
                  type="checkbox"
                  :checked="member.deny_comment"
                  :disabled="!canManage || isSelf(member) || member.role !== 'member'"
                  @change="toggleDeny(member, 'deny_comment')"
                />
                评论
              </label>
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
                <WinButton Style="SubtleButtonStyle" @Click="ban(member)">拉黑</WinButton>
              </template>
              <WinButton v-if="isOwner" Style="SubtleButtonStyle" @Click="transfer(member)">转让领主</WinButton>
            </div>
          </template>

          <div v-else class="member-row__actions">
            <WinButton v-if="canManage" Style="SubtleButtonStyle" @Click="unban(member)">解除拉黑</WinButton>
          </div>
        </li>
      </ul>
    </div>

    <div v-else class="stronghold-panel__body">
      <div v-if="settingsLoading" class="stronghold-panel__loading">加载中…</div>
      <template v-else>
        <p v-if="settingsError" class="notice notice--error">{{ settingsError }}</p>

        <div class="field">
          <label class="field__label" for="sh-name">名称</label>
          <input id="sh-name" v-model="form.name" type="text" />
        </div>
        <div class="field">
          <label class="field__label" for="sh-desc">描述</label>
          <textarea id="sh-desc" v-model="form.description" rows="3"></textarea>
        </div>
        <div class="field">
          <label class="field__label" for="sh-cover">封面图 URL</label>
          <input id="sh-cover" v-model="form.cover" type="text" />
        </div>
        <div class="field">
          <label class="field__label" for="sh-visibility">可见性</label>
          <select id="sh-visibility" v-model="form.visibility" :disabled="!isOwner">
            <option value="public">公开</option>
            <option value="private">私密</option>
          </select>
          <p v-if="!isOwner" class="field__hint">仅领主可修改可见性</p>
        </div>
        <label class="stronghold-panel__toggle">
          <input v-model="form.allow_message_edit" type="checkbox" />
          <span>允许编辑消息</span>
        </label>
        <label class="stronghold-panel__toggle">
          <input v-model="form.allow_message_retract" type="checkbox" />
          <span>允许撤回消息</span>
        </label>
        <div class="field">
          <label class="field__label" for="sh-window">编辑/撤回窗口（秒，0 表示不限）</label>
          <input id="sh-window" v-model.number="form.edit_window_secs" type="number" min="0" />
        </div>

        <div class="stronghold-panel__save">
          <p v-if="settingsSaveOk" class="stronghold-panel__save-ok">已保存</p>
          <WinButton Style="AccentButtonStyle" :IsEnabled="!settingsSaving" @Click="saveSettings">
            {{ settingsSaving ? '保存中…' : '保存设置' }}
          </WinButton>
        </div>
      </template>
    </div>

    <MemberInfoCard v-if="infoCardMember" :member="infoCardMember" @close="infoCardMember = null" />
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
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  margin-bottom: 1rem;
  border-radius: var(--radius-sm);
  background: var(--ctrl-fill-secondary);
}

.stronghold-panel__tab {
  flex: 1;
  padding: 0.45rem;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 0.85rem;
  transition: background var(--fast-duration) var(--fast-out-slow-in), color var(--fast-duration);
}

.stronghold-panel__tab--active {
  background: rgb(var(--colors-primary));
  color: var(--on-accent);
}

.stronghold-panel__body {
  width: 100%;
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.stronghold-panel__loading,
.stronghold-panel__empty {
  color: var(--text-tertiary);
  font-size: 0.85rem;
}

.member-subtabs {
  display: flex;
  gap: 0.4rem;
}

.member-subtabs__item {
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--ctrl-border);
  background: var(--ctrl-fill-secondary);
  color: var(--text-secondary);
  font-size: 0.78rem;
  transition: background var(--fast-duration) var(--fast-out-slow-in), color var(--fast-duration);
}

.member-subtabs__item--active {
  background: rgb(var(--colors-primary));
  border-color: transparent;
  color: var(--on-accent);
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
  gap: 0.65rem;
  font-size: 0.76rem;
  color: var(--text-secondary);
}

.member-row__deny-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.member-row__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-left: auto;
}

.stronghold-panel__toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-primary);
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
