<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api, ApiRequestError } from '../api'
import type { AuthResponse, InstanceConfig, RootRequirement } from '../api/types'
import { useAuth } from '../composables/useAuth'
import {
  downloadOwnershipBackup,
  envelopeToCiphertextField,
  generateOwnershipKey,
  type OwnershipEnvelope,
} from '../crypto/ownershipKey'
import { WinButton } from '../vendor/winui'

const auth = useAuth()

type Tab = 'login' | 'register'
const tab = ref<Tab>('login')

const configLoading = ref(true)
const configError = ref('')
const instanceConfig = ref<InstanceConfig>({ allow_root: false, root_requirements: [] })

onMounted(async () => {
  try {
    instanceConfig.value = await api.getInstanceConfig()
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
  registerError.value = ''
  if (registerForm.ownershipPassphrase.length < 8) {
    registerError.value = '所有权口令至少需要 8 位'
    return
  }
  if (registerForm.ownershipPassphrase !== registerForm.ownershipPassphraseConfirm) {
    registerError.value = '两次输入的所有权口令不一致'
    return
  }
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
        <p v-if="configError" class="notice notice--error">{{ configError }}</p>

        <div v-if="instanceConfig.allow_root" class="auth-card__tabs">
          <button
            type="button"
            class="auth-card__tab"
            :class="{ 'auth-card__tab--active': tab === 'login' }"
            @click="tab = 'login'"
          >
            登录
          </button>
          <button
            type="button"
            class="auth-card__tab"
            :class="{ 'auth-card__tab--active': tab === 'register' }"
            @click="tab = 'register'"
          >
            注册
          </button>
        </div>

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
            <p class="notice notice--info">
              注册成功。请务必导出并妥善保管所有权密钥备份——它是账号迁移的唯一凭证，服务器不会保存明文私钥。
            </p>
            <WinButton Style="DefaultButtonStyle" @Click="exportBackup">导出所有权密钥备份</WinButton>
            <WinButton Style="AccentButtonStyle" class="auth-form__submit" @Click="finishRegistration">
              进入 OpenMew
            </WinButton>
          </div>

          <form v-else class="auth-form" @submit.prevent="submitRegister">
            <div class="field">
              <label class="field__label" for="register-username">用户名</label>
              <input id="register-username" v-model.trim="registerForm.username" type="text" autocomplete="username" required />
            </div>
            <div class="field">
              <label class="field__label" for="register-password">密码</label>
              <input
                id="register-password"
                v-model="registerForm.password"
                type="password"
                autocomplete="new-password"
                required
              />
            </div>
            <div v-if="needs('email')" class="field">
              <label class="field__label" for="register-email">邮箱</label>
              <input id="register-email" v-model.trim="registerForm.email" type="email" autocomplete="email" required />
            </div>
            <p v-if="needs('phone')" class="notice notice--caution">本实例暂不支持手机注册</p>
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
                  minlength="8"
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
                  minlength="8"
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

        <p v-if="!instanceConfig.allow_root" class="notice notice--info">本节点不开放注册。如需账号，请联系节点管理员。</p>
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
  padding: calc(var(--topbar-height) + 2rem) 1rem 2rem;
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
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  border-radius: var(--radius-sm);
  background: var(--ctrl-fill-secondary);
}

.auth-card__tab {
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

.auth-card__tab--active {
  background: var(--accent-base);
  color: var(--accent-text);
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
