<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api, ApiRequestError } from '../api'
import type { AuthResponse, InstanceConfig, RootRequirement } from '../api/types'
import { useAuth } from '../composables/useAuth'
import {
  downloadOwnershipBackup,
  envelopeToCiphertextField,
  generateOwnershipKey,
  type OwnershipEnvelope,
} from '../crypto/ownershipKey'
import { emailError, ownershipPassphraseError, passwordError, requiredError, usernameError } from '../utils/validate'
import { WinButton, WinInfoBar, WinSelectorBar } from '../vendor/winui'

const auth = useAuth()

type Tab = 'login' | 'register'
const tab = ref<Tab>('login')
const TAB_OPTIONS: { Text: string; value: Tab }[] = [
  { Text: '登录', value: 'login' },
  { Text: '注册', value: 'register' },
]
const tabSelected = computed(() => TAB_OPTIONS.find((o) => o.value === tab.value))
function onTabSelect(item: { value: Tab }) {
  tab.value = item.value
}

const configLoading = ref(true)
const configError = ref('')
const instanceConfig = ref<InstanceConfig>({ allow_root: false, root_requirements: [], stronghold_creation: 'open' })

onMounted(async () => {
  try {
    instanceConfig.value = await api.getInstanceConfig()
    // a fresh visitor lands on the register tab when the instance takes open
    // signups - a session that got kicked back here by a 401 stays on login
    // (App.vue only mounts this gate once auth.isAuthenticated goes false).
    if (instanceConfig.value.allow_root && !auth.sessionExpired.value) tab.value = 'register'
  } catch {
    configError.value = '无法获取节点配置，请稍后重试'
  } finally {
    configLoading.value = false
  }
})

function needs(req: RootRequirement) {
  return instanceConfig.value.root_requirements.includes(req)
}

const loginForm = reactive({ username: '', password: '' })
const loginError = ref('')
const loginBusy = ref(false)

async function submitLogin() {
  loginError.value = ''
  loginBusy.value = true
  try {
    await auth.login({ username: loginForm.username, password: loginForm.password })
  } catch (err) {
    loginError.value =
      err instanceof ApiRequestError && err.code === 'AUTH_FAILED' ? '用户名或密码错误' : '登录失败，请稍后重试'
  } finally {
    loginBusy.value = false
  }
}

const registerForm = reactive({
  username: '',
  password: '',
  email: '',
  code: '',
  ownershipPassphrase: '',
  ownershipPassphraseConfirm: '',
})
const registerError = ref('')
const registerBusy = ref(false)
const pendingBackup = ref<{ session: AuthResponse; pubkeyBase64: string; envelope: OwnershipEnvelope } | null>(null)

// live per-keystroke feedback for username format - only surfaced once the
// user has actually typed something, so a fresh empty field stays quiet
const liveUsernameError = computed(() => (registerForm.username ? usernameError(registerForm.username) : ''))

function registerErrorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    switch (err.code) {
      case 'REGISTRATION_DISABLED':
        return '本节点当前未开放注册'
      case 'INVITE_INVALID':
        return '邀请码无效或已被使用'
      case 'PHONE_UNSUPPORTED':
        return '本实例暂不支持手机注册'
      case 'USERNAME_INVALID':
        return '用户名不可用，请更换后重试'
      default:
        return '注册失败，请稍后重试'
    }
  }
  return '注册失败，请稍后重试'
}

async function submitRegister() {
  const errors = [
    usernameError(registerForm.username),
    passwordError(registerForm.password),
    needs('email') ? emailError(registerForm.email) : '',
    needs('code') ? requiredError(registerForm.code, '邀请码') : '',
    ownershipPassphraseError(registerForm.ownershipPassphrase, registerForm.password),
  ].filter(Boolean)
  if (registerForm.ownershipPassphrase !== registerForm.ownershipPassphraseConfirm) errors.push('两次输入的所有权口令不一致')
  registerError.value = errors.join('；')
  if (registerError.value) return
  registerBusy.value = true
  try {
    const { pubkeyBase64, envelope } = await generateOwnershipKey(registerForm.ownershipPassphrase)
    const session = await auth.register({
      username: registerForm.username,
      password: registerForm.password,
      email: needs('email') ? registerForm.email : undefined,
      code: needs('code') ? registerForm.code : undefined,
      ownership_pubkey: pubkeyBase64,
      ownership_ciphertext: envelopeToCiphertextField(envelope),
    })
    pendingBackup.value = { session, pubkeyBase64, envelope }
  } catch (err) {
    registerError.value = registerErrorMessage(err)
  } finally {
    registerBusy.value = false
  }
}

function exportBackup() {
  if (!pendingBackup.value) return
  downloadOwnershipBackup(pendingBackup.value.pubkeyBase64, pendingBackup.value.envelope, pendingBackup.value.session.user.username)
}

function finishRegistration() {
  if (!pendingBackup.value) return
  auth.setSession(pendingBackup.value.session)
}
</script>

<template>
  <div class="auth-gate">
    <div class="auth-card">
      <h1 class="auth-card__title">OpenMew</h1>

      <div v-if="configLoading" class="auth-card__loading">正在获取节点信息…</div>

      <template v-else>
        <WinInfoBar v-if="configError" :IsOpen="true" :IsClosable="false" :IsIconVisible="false" Severity="Error">
          {{ configError }}
        </WinInfoBar>

        <WinSelectorBar
          v-if="instanceConfig.allow_root"
          class="auth-card__tabs"
          :Items="TAB_OPTIONS"
          :SelectedItem="tabSelected"
          @update:SelectedItem="onTabSelect"
        />

        <form v-if="tab === 'login'" class="auth-form" @submit.prevent="submitLogin">
          <div class="field">
            <label class="field__label" for="login-username">用户名</label>
            <input id="login-username" v-model.trim="loginForm.username" type="text" autocomplete="username" required />
          </div>
          <div class="field">
            <label class="field__label" for="login-password">密码</label>
            <input id="login-password" v-model="loginForm.password" type="password" autocomplete="current-password" required />
          </div>
          <p v-if="loginError" class="field__error">{{ loginError }}</p>
          <WinButton Style="AccentButtonStyle" class="auth-form__submit" type="submit" :IsEnabled="!loginBusy">
            {{ loginBusy ? '登录中…' : '登录' }}
          </WinButton>
        </form>

        <template v-else>
          <div v-if="pendingBackup" class="auth-form">
            <WinInfoBar :IsOpen="true" :IsClosable="false" :IsIconVisible="false" Severity="Success">
              注册成功。请务必导出并妥善保管所有权密钥备份——它是账号迁移的唯一凭证，服务器不会保存明文私钥。
            </WinInfoBar>
            <WinButton Style="DefaultButtonStyle" @Click="exportBackup">导出所有权密钥备份</WinButton>
            <WinButton Style="AccentButtonStyle" class="auth-form__submit" @Click="finishRegistration">
              进入 OpenMew
            </WinButton>
          </div>

          <form v-else class="auth-form" @submit.prevent="submitRegister">
            <div class="field">
              <label class="field__label" for="register-username">用户名</label>
              <input
                id="register-username"
                v-model.trim="registerForm.username"
                type="text"
                autocomplete="username"
                pattern="[a-z0-9_\-]{2,32}"
                maxlength="32"
                required
              />
              <p v-if="liveUsernameError" class="field__error">{{ liveUsernameError }}</p>
            </div>
            <div class="field">
              <label class="field__label" for="register-password">密码</label>
              <input
                id="register-password"
                v-model="registerForm.password"
                type="password"
                autocomplete="new-password"
                minlength="10"
                required
              />
            </div>
            <div v-if="needs('email')" class="field">
              <label class="field__label" for="register-email">邮箱</label>
              <input id="register-email" v-model.trim="registerForm.email" type="email" autocomplete="email" required />
            </div>
            <WinInfoBar v-if="needs('phone')" :IsOpen="true" :IsClosable="false" :IsIconVisible="false" Severity="Warning">
              本实例暂不支持手机注册
            </WinInfoBar>
            <div v-if="needs('code')" class="field">
              <label class="field__label" for="register-code">邀请码</label>
              <input id="register-code" v-model.trim="registerForm.code" type="text" required />
            </div>

            <fieldset class="auth-form__ownership">
              <legend class="field__label">所有权口令</legend>
              <p class="field__hint">
                独立于登录密码，永远不会发送到服务器——仅在本地用于加密你的账号所有权密钥，供将来账号迁移使用。请牢记，遗失后将无法找回。
              </p>
              <div class="field">
                <label class="field__label" for="register-ownership">所有权口令</label>
                <input
                  id="register-ownership"
                  v-model="registerForm.ownershipPassphrase"
                  type="password"
                  autocomplete="new-password"
                  minlength="10"
                  required
                />
              </div>
              <div class="field">
                <label class="field__label" for="register-ownership-confirm">确认所有权口令</label>
                <input
                  id="register-ownership-confirm"
                  v-model="registerForm.ownershipPassphraseConfirm"
                  type="password"
                  autocomplete="new-password"
                  minlength="10"
                  required
                />
              </div>
            </fieldset>

            <p v-if="registerError" class="field__error">{{ registerError }}</p>
            <WinButton Style="AccentButtonStyle" class="auth-form__submit" type="submit" :IsEnabled="!registerBusy">
              {{ registerBusy ? '注册中…' : '注册' }}
            </WinButton>
          </form>
        </template>

        <WinInfoBar v-if="!instanceConfig.allow_root" :IsOpen="true" :IsClosable="false" :IsIconVisible="false" Severity="Informational">
          本节点不开放注册。如需账号，请联系节点管理员。
        </WinInfoBar>
      </template>
    </div>
  </div>
</template>

<style scoped>
.auth-gate {
  position: relative;
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
}

.auth-card {
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  padding: 2rem;
  border-radius: var(--radius-md);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18);
}

.auth-card__title {
  margin: 0;
  text-align: center;
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--text-primary);
}

.auth-card__loading {
  text-align: center;
  font-size: 0.85rem;
  color: var(--text-tertiary);
}

.auth-card__tabs {
  padding: 0.25rem;
  border-radius: var(--radius-sm);
  background: var(--ctrl-fill-secondary);
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.auth-form__submit {
  width: 100%;
  justify-content: center;
  margin-top: 0.15rem;
}

.auth-form__ownership {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 0.85rem;
  border: 1px solid var(--stroke-divider);
  border-radius: var(--radius-sm);
}

.auth-form__ownership legend {
  padding: 0 0.3rem;
}
</style>
