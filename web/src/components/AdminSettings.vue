<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api, ApiRequestError } from '../api'
import type { InviteCode, RootRequirement } from '../api/types'
import { useAuth } from '../composables/useAuth'
import { WinButton } from '../vendor/winui'

defineEmits<{ close: [] }>()

const auth = useAuth()

const REQUIREMENT_OPTIONS: { value: RootRequirement; label: string }[] = [
  { value: 'email', label: '邮箱' },
  { value: 'phone', label: '手机号' },
  { value: 'code', label: '邀请码' },
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
})

const inviteCodes = ref<InviteCode[]>([])
const inviteCount = ref(1)
const inviteBusy = ref(false)
const inviteError = ref('')

async function loadConfig() {
  if (!auth.token.value) return
  loading.value = true
  loadError.value = ''
  try {
    const config = await api.getAdminConfig(auth.token.value)
    form.allow_root = config.allow_root
    form.root_requirements = [...config.root_requirements]
    form.trusted_identity_servers_text = config.trusted_identity_servers.join('\n')
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

onMounted(() => {
  loadConfig()
  loadInviteCodes()
})

function toggleRequirement(value: RootRequirement, checked: boolean) {
  if (checked) {
    if (!form.root_requirements.includes(value)) form.root_requirements.push(value)
  } else {
    form.root_requirements = form.root_requirements.filter((item) => item !== value)
  }
}

const trustedServers = computed(() =>
  form.trusted_identity_servers_text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
)

async function save() {
  if (!auth.token.value) return
  saving.value = false
  saveError.value = ''
  saveOk.value = false
  saving.value = true
  try {
    await api.patchAdminConfig(auth.token.value, {
      allow_root: form.allow_root,
      root_requirements: form.root_requirements,
      trusted_identity_servers: trustedServers.value,
    })
    saveOk.value = true
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
    <p v-else-if="loadError" class="notice notice--error">{{ loadError }}</p>

    <div v-else class="admin-settings__body">
      <section class="admin-card">
        <h2 class="admin-card__title">根节点</h2>
        <label class="admin-toggle">
          <input v-model="form.allow_root" type="checkbox" />
          <span>作为根节点（开放独立注册）</span>
        </label>
        <p class="field__hint">关闭后本节点仅接受已存在账号登录，新用户无法在本节点直接注册。</p>
      </section>

      <section class="admin-card">
        <h2 class="admin-card__title">注册门槛</h2>
        <p class="field__hint">注册时要求提交的附加信息，可多选。</p>
        <div class="admin-checkbox-group">
          <label v-for="option in REQUIREMENT_OPTIONS" :key="option.value" class="admin-toggle">
            <input
              type="checkbox"
              :checked="form.root_requirements.includes(option.value)"
              @change="toggleRequirement(option.value, ($event.target as HTMLInputElement).checked)"
            />
            <span>{{ option.label }}</span>
          </label>
        </div>
        <p v-if="form.root_requirements.includes('phone')" class="notice notice--caution">
          手机号注册目前客户端暂未实现，勾选后新用户注册会被拒绝。
        </p>
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
            <span class="admin-invite__status" :class="{ 'admin-invite__status--used': invite.used }">
              {{ invite.used ? '已使用' : '未使用' }}
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

.admin-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-primary);
}

.admin-checkbox-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.25rem;
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
