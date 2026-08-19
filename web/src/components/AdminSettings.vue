<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { api, ApiRequestError } from '../api'
import type { InviteCode, RootRequirement, StrongholdApplication, StrongholdCreationPolicy } from '../api/types'
import { useAuth } from '../composables/useAuth'
import { actorListError, domainListError, trustedServersError } from '../utils/validate'
import { WinButton, WinInfoBar, WinSelectorBar, WinToggleSwitch } from '../vendor/winui'

defineEmits<{ close: [] }>()

const auth = useAuth()

const REQUIREMENT_OPTIONS: { value: RootRequirement; label: string }[] = [
  { value: 'email', label: '邮箱' },
  { value: 'phone', label: '手机号' },
  { value: 'code', label: '邀请码' },
]

const CREATION_POLICY_OPTIONS: { Text: string; value: StrongholdCreationPolicy; hint: string }[] = [
  { Text: '开放', value: 'open', hint: '任何用户都可以创建据点' },
  { Text: '限制', value: 'restricted', hint: '仅名单内的用户可以创建据点' },
  { Text: '申请制', value: 'application', hint: '用户提交申请，由管理员审批' },
]

const loading = ref(true)
const loadError = ref('')
const saving = ref(false)
const saveError = ref('')
const saveOk = ref(false)

const form = reactive({
  allow_root: false,
  root_requirements: [] as RootRequirement[],
  trusted_identity_servers_text: '',
  federation_peers_text: '',
  stronghold_creation_policy: 'open' as StrongholdCreationPolicy,
  stronghold_creators_text: '',
})

const inviteCodes = ref<InviteCode[]>([])
const inviteCount = ref(1)
const inviteBusy = ref(false)
const inviteError = ref('')

const pendingApplications = ref<StrongholdApplication[]>([])
const applicationsError = ref('')
const decidingId = ref('')
const approvedNotice = ref('')

async function loadConfig() {
  if (!auth.token.value) return
  loading.value = true
  loadError.value = ''
  try {
    const config = await api.getAdminConfig(auth.token.value)
    form.allow_root = config.allow_root
    form.root_requirements = [...config.root_requirements]
    form.trusted_identity_servers_text = config.trusted_identity_servers.join('\n')
    form.federation_peers_text = config.federation_peers.join('\n')
    form.stronghold_creation_policy = config.stronghold_creation_policy
    form.stronghold_creators_text = config.stronghold_creators.join('\n')
  } catch {
    loadError.value = '无法加载设置，请稍后重试'
  } finally {
    loading.value = false
  }
}

async function loadInviteCodes() {
  if (!auth.token.value) return
  try {
    inviteCodes.value = await api.listInviteCodes(auth.token.value)
  } catch {
    // non-fatal — the invite list is secondary to the settings form
  }
}

async function loadPendingApplications() {
  if (!auth.token.value) return
  applicationsError.value = ''
  try {
    pendingApplications.value = await api.getAdminStrongholdApplications(auth.token.value, 'pending')
  } catch {
    applicationsError.value = '无法加载待审申请'
  }
}

watch(
  () => form.stronghold_creation_policy,
  (policy) => {
    if (policy === 'application') void loadPendingApplications()
  },
)

async function decideApplication(id: string, state: 'approved' | 'rejected') {
  if (!auth.token.value || decidingId.value) return
  decidingId.value = id
  approvedNotice.value = ''
  try {
    await api.decideStrongholdApplication(auth.token.value, id, state)
    if (state === 'approved') approvedNotice.value = '已批准，据点已创建'
    await loadPendingApplications()
  } catch (err) {
    applicationsError.value = err instanceof ApiRequestError ? `操作失败：${err.code}` : '操作失败，请稍后重试'
  } finally {
    decidingId.value = ''
  }
}

onMounted(() => {
  loadConfig().then(() => {
    if (form.stronghold_creation_policy === 'application') void loadPendingApplications()
  })
  loadInviteCodes()
})

function toggleRequirement(value: RootRequirement, checked: boolean) {
  if (checked) {
    if (!form.root_requirements.includes(value)) form.root_requirements.push(value)
  } else {
    form.root_requirements = form.root_requirements.filter((item) => item !== value)
  }
}

function linesToList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

const trustedServers = computed(() => linesToList(form.trusted_identity_servers_text))
const federationPeers = computed(() => linesToList(form.federation_peers_text))
const strongholdCreators = computed(() => linesToList(form.stronghold_creators_text))

const creationPolicySelected = computed(() => CREATION_POLICY_OPTIONS.find((o) => o.value === form.stronghold_creation_policy))
function onCreationPolicySelect(item: { value: StrongholdCreationPolicy }) {
  form.stronghold_creation_policy = item.value
}

async function save() {
  if (!auth.token.value) return
  saveError.value =
    trustedServersError(form.trusted_identity_servers_text) ||
    domainListError(form.federation_peers_text) ||
    (form.stronghold_creation_policy === 'restricted' ? actorListError(form.stronghold_creators_text) : '')
  if (saveError.value) return
  saveOk.value = false
  saving.value = true
  try {
    await api.patchAdminConfig(auth.token.value, {
      allow_root: form.allow_root,
      root_requirements: form.root_requirements,
      trusted_identity_servers: trustedServers.value,
      federation_peers: federationPeers.value,
      stronghold_creation_policy: form.stronghold_creation_policy,
      stronghold_creators: strongholdCreators.value,
    })
    saveOk.value = true
    if (form.stronghold_creation_policy === 'application') void loadPendingApplications()
  } catch (err) {
    saveError.value = err instanceof ApiRequestError ? `保存失败：${err.code}` : '保存失败，请稍后重试'
  } finally {
    saving.value = false
  }
}

async function generateInviteCodes() {
  if (!auth.token.value) return
  inviteError.value = ''
  inviteBusy.value = true
  try {
    inviteCodes.value = await api.createInviteCodes(auth.token.value, inviteCount.value)
  } catch (err) {
    inviteError.value = err instanceof ApiRequestError ? `生成失败：${err.code}` : '生成失败，请稍后重试'
  } finally {
    inviteBusy.value = false
  }
}
</script>

<template>
  <div class="admin-settings">
    <div class="admin-settings__header">
      <WinButton Style="SubtleButtonStyle" @Click="$emit('close')">返回</WinButton>
      <h1 class="admin-settings__title">节点设置</h1>
    </div>

    <div v-if="loading" class="admin-settings__loading">正在加载设置…</div>
    <WinInfoBar v-else-if="loadError" :IsOpen="true" :IsClosable="false" :IsIconVisible="false" Severity="Error">
      {{ loadError }}
    </WinInfoBar>

    <div v-else class="admin-settings__body">
      <section class="admin-card">
        <h2 class="admin-card__title">根节点</h2>
        <WinToggleSwitch v-model="form.allow_root">作为根节点（开放独立注册）</WinToggleSwitch>
        <p class="field__hint">关闭后本节点仅接受已存在账号登录，新用户无法在本节点直接注册。</p>
      </section>

      <section class="admin-card">
        <h2 class="admin-card__title">注册门槛</h2>
        <p class="field__hint">注册时要求提交的附加信息，可多选。</p>
        <div class="admin-checkbox-group">
          <WinToggleSwitch
            v-for="option in REQUIREMENT_OPTIONS"
            :key="option.value"
            :modelValue="form.root_requirements.includes(option.value)"
            @update:modelValue="(checked: boolean) => toggleRequirement(option.value, checked)"
          >
            {{ option.label }}
          </WinToggleSwitch>
        </div>
        <WinInfoBar
          v-if="form.root_requirements.includes('phone')"
          :IsOpen="true"
          :IsClosable="false"
          :IsIconVisible="false"
          Severity="Warning"
        >
          手机号注册目前客户端暂未实现，勾选后新用户注册会被拒绝。
        </WinInfoBar>
      </section>

      <section class="admin-card">
        <h2 class="admin-card__title">信任身份服务器</h2>
        <p class="field__hint">每行一个域名；填写 <code>*</code> 表示承认所有服务器身份。</p>
        <div class="field">
          <textarea
            v-model="form.trusted_identity_servers_text"
            rows="5"
            placeholder="example.com&#10;*"
          ></textarea>
        </div>
      </section>

      <section class="admin-card">
        <h2 class="admin-card__title">联邦对等实例</h2>
        <p class="field__hint">每行一个域名，内容联邦仅向此列表投递。</p>
        <div class="field">
          <textarea
            v-model="form.federation_peers_text"
            rows="4"
            placeholder="peer.example.com"
          ></textarea>
        </div>
      </section>

      <section class="admin-card">
        <h2 class="admin-card__title">建据点策略</h2>
        <WinSelectorBar
          class="admin-radio-group"
          :Items="CREATION_POLICY_OPTIONS"
          :SelectedItem="creationPolicySelected"
          @update:SelectedItem="onCreationPolicySelect"
        />
        <p class="field__hint">{{ creationPolicySelected?.hint }}</p>

        <div v-if="form.stronghold_creation_policy === 'restricted'" class="field">
          <label class="field__label" for="creators-text">允许创建的用户（actor，每行一个）</label>
          <textarea
            id="creators-text"
            v-model="form.stronghold_creators_text"
            rows="4"
            placeholder="@alice:example.com"
          ></textarea>
        </div>

        <div v-if="form.stronghold_creation_policy === 'application'" class="admin-applications">
          <h3 class="admin-applications__title">待审申请</h3>
          <p v-if="approvedNotice" class="admin-settings__save-ok">{{ approvedNotice }}</p>
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
                <WinButton
                  Style="AccentButtonStyle"
                  :IsEnabled="!decidingId"
                  @Click="decideApplication(app.id, 'approved')"
                >
                  批准
                </WinButton>
                <WinButton Style="SubtleButtonStyle" :IsEnabled="!decidingId" @Click="decideApplication(app.id, 'rejected')">
                  拒绝
                </WinButton>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <div class="admin-settings__save">
        <p v-if="saveError" class="field__error">{{ saveError }}</p>
        <p v-if="saveOk" class="admin-settings__save-ok">已保存</p>
        <WinButton Style="AccentButtonStyle" :IsEnabled="!saving" @Click="save">
          {{ saving ? '保存中…' : '保存设置' }}
        </WinButton>
      </div>

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
    </div>
  </div>
</template>

<style scoped>
.admin-settings {
  height: 100%;
  overflow-y: auto;
  padding: 1.5rem 1.5rem 2rem;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.admin-settings__header {
  width: 100%;
  max-width: 640px;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.admin-settings__title {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--text-primary);
}

.admin-settings__loading {
  color: var(--text-tertiary);
  font-size: 0.85rem;
}

.admin-settings__body {
  width: 100%;
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 1rem;
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

.admin-checkbox-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.25rem;
}

.admin-applications {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--stroke-divider);
}

.admin-applications__title {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
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

.admin-settings__save {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.admin-settings__save-ok {
  margin: 0;
  font-size: 0.8rem;
  color: var(--SystemFillColorSuccessBrush);
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
</style>
