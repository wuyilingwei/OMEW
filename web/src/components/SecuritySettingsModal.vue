<script setup lang="ts">
import { startRegistration } from '@simplewebauthn/browser'
import QRCode from 'qrcode'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { api, ApiRequestError } from '../api'
import type { Passkey } from '../api/types'
import { useAuth } from '../composables/useAuth'
import { WinButton, WinInfoBar, WinSelectorBar } from '../vendor/winui'
import AppIcon from './icons/AppIcon.vue'

// account "安全" section: passkey (WebAuthn) management + TOTP second-factor
// wizard, both instance-local per spec §7.2a. Same Teleport-to-body overlay
// shell family as ChangePasswordModal, hosting two sub-panels with their own
// step state.

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const auth = useAuth()

const supportsPasskeys = typeof window !== 'undefined' && !!window.PublicKeyCredential

type Tab = 'passkeys' | 'totp'
const tab = ref<Tab>(supportsPasskeys ? 'passkeys' : 'totp')
const TAB_OPTIONS = computed(() => {
  const opts: { Text: string; value: Tab }[] = []
  if (supportsPasskeys) opts.push({ Text: '通行密钥', value: 'passkeys' })
  opts.push({ Text: '两步验证', value: 'totp' })
  return opts
})
const tabSelected = computed(() => TAB_OPTIONS.value.find((o) => o.value === tab.value))
function onTabSelect(item: { value: Tab }) {
  tab.value = item.value
}

function requestClose() {
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) requestClose()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString()
}

// ---- passkeys ---------------------------------------------------------------

const passkeys = ref<Passkey[]>([])
const passkeysLoading = ref(false)
const passkeysError = ref('')

async function loadPasskeys() {
  if (!auth.token.value) return
  passkeysLoading.value = true
  passkeysError.value = ''
  try {
    passkeys.value = await api.listPasskeys(auth.token.value)
  } catch {
    passkeysError.value = '通行密钥列表加载失败'
  } finally {
    passkeysLoading.value = false
  }
}

const addingPasskey = ref(false)
const newPasskeyName = ref('')
const addPasskeyBusy = ref(false)
const addPasskeyError = ref('')

function startAddPasskey() {
  addingPasskey.value = true
  newPasskeyName.value = ''
  addPasskeyError.value = ''
}

function cancelAddPasskey() {
  addingPasskey.value = false
}

async function submitAddPasskey() {
  if (!auth.token.value || !newPasskeyName.value.trim()) {
    addPasskeyError.value = '请输入名称'
    return
  }
  addPasskeyBusy.value = true
  addPasskeyError.value = ''
  try {
    const { options, challenge_token } = await api.passkeyRegOptions(auth.token.value)
    const response = await startRegistration({ optionsJSON: options })
    const created = await api.registerPasskey(auth.token.value, response, challenge_token, newPasskeyName.value.trim())
    passkeys.value = [...passkeys.value, created]
    addingPasskey.value = false
  } catch (err) {
    addPasskeyError.value = err instanceof ApiRequestError && err.code === 'PASSKEY_ALREADY_REGISTERED'
      ? '该通行密钥已注册'
      : '添加失败，请重试'
  } finally {
    addPasskeyBusy.value = false
  }
}

const renamingId = ref<string | null>(null)
const renameValue = ref('')

function startRename(passkey: Passkey) {
  renamingId.value = passkey.id
  renameValue.value = passkey.name
}

async function submitRename(passkey: Passkey) {
  if (!auth.token.value || !renameValue.value.trim()) return
  try {
    const updated = await api.renamePasskey(auth.token.value, passkey.id, renameValue.value.trim())
    passkeys.value = passkeys.value.map((p) => (p.id === updated.id ? updated : p))
  } finally {
    renamingId.value = null
  }
}

async function deletePasskey(passkey: Passkey) {
  if (!auth.token.value) return
  if (!confirm(`确定删除通行密钥「${passkey.name}」？`)) return
  await api.deletePasskey(auth.token.value, passkey.id)
  passkeys.value = passkeys.value.filter((p) => p.id !== passkey.id)
}

// ---- TOTP ---------------------------------------------------------------

type TotpStep = 'status' | 'setup-scan' | 'setup-verify' | 'disable'
const totpStep = ref<TotpStep>('status')
const totpEnabled = computed(() => !!auth.user.value && auth.user.value.totp_enabled === true)

const totpSecret = ref('')
const totpQrDataUrl = ref('')
const totpCode = ref('')
const totpBusy = ref(false)
const totpError = ref('')

async function beginTotpSetup() {
  if (!auth.token.value) return
  totpBusy.value = true
  totpError.value = ''
  try {
    const { secret, otpauth_url } = await api.totpSetup(auth.token.value)
    totpSecret.value = secret
    totpQrDataUrl.value = await QRCode.toDataURL(otpauth_url)
    totpStep.value = 'setup-scan'
  } catch {
    totpError.value = '初始化失败，请重试'
  } finally {
    totpBusy.value = false
  }
}

function goToVerify() {
  totpCode.value = ''
  totpError.value = ''
  totpStep.value = 'setup-verify'
}

async function submitTotpActivate() {
  if (!auth.token.value) return
  totpBusy.value = true
  totpError.value = ''
  try {
    await api.totpActivate(auth.token.value, totpCode.value.trim())
    auth.updateUser({ totp_enabled: true })
    totpStep.value = 'status'
  } catch (err) {
    totpError.value = err instanceof ApiRequestError && err.code === 'TOTP_INVALID' ? '验证码不正确' : '激活失败，请重试'
  } finally {
    totpBusy.value = false
  }
}

const disableForm = reactive({ password: '', code: '' })

function beginTotpDisable() {
  disableForm.password = ''
  disableForm.code = ''
  totpError.value = ''
  totpStep.value = 'disable'
}

async function submitTotpDisable() {
  if (!auth.token.value) return
  totpBusy.value = true
  totpError.value = ''
  try {
    await api.totpDisable(auth.token.value, disableForm.password, disableForm.code.trim())
    auth.updateUser({ totp_enabled: false })
    totpStep.value = 'status'
  } catch (err) {
    totpError.value = err instanceof ApiRequestError && err.code === 'TOTP_INVALID' ? '验证码不正确' : '密码或验证码不正确'
  } finally {
    totpBusy.value = false
  }
}

function cancelTotpFlow() {
  totpStep.value = 'status'
  totpError.value = ''
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      tab.value = supportsPasskeys ? 'passkeys' : 'totp'
      addingPasskey.value = false
      totpStep.value = 'status'
      loadPasskeys()
    }
  },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="security-modal">
      <div v-if="open" class="security-modal-overlay" @click.self="requestClose">
        <div class="security-modal" role="dialog" aria-modal="true">
          <div class="security-modal__header">
            <h1 class="security-modal__title">安全</h1>
            <WinButton Style="SubtleButtonStyle" @Click="requestClose">关闭</WinButton>
          </div>

          <WinSelectorBar
            v-if="TAB_OPTIONS.length > 1"
            class="security-modal__tabs"
            :Items="TAB_OPTIONS"
            :SelectedItem="tabSelected"
            @update:SelectedItem="onTabSelect"
          />

          <div class="security-modal__body">
            <!-- 通行密钥 -->
            <section v-if="tab === 'passkeys'" class="security-section">
              <p class="security-section__hint">
                通行密钥使用设备本地认证器（指纹、面容或安全密钥）免密登录，仅对本节点生效。
              </p>
              <WinInfoBar v-if="passkeysError" :IsOpen="true" :IsClosable="false" :IsIconVisible="false" Severity="Error">
                {{ passkeysError }}
              </WinInfoBar>

              <div v-if="passkeysLoading" class="security-section__loading">加载中…</div>
              <ul v-else-if="passkeys.length" class="passkey-list">
                <li v-for="pk in passkeys" :key="pk.id" class="passkey-list__item">
                  <AppIcon name="key" :size="18" class="passkey-list__icon" />
                  <div class="passkey-list__body">
                    <template v-if="renamingId === pk.id">
                      <input
                        v-model="renameValue"
                        class="passkey-list__rename-input"
                        type="text"
                        maxlength="40"
                        @keyup.enter="submitRename(pk)"
                        @keyup.escape="renamingId = null"
                      />
                    </template>
                    <template v-else>
                      <span class="passkey-list__name">{{ pk.name }}</span>
                      <span class="passkey-list__meta">添加于 {{ formatDate(pk.created_at) }}</span>
                    </template>
                  </div>
                  <div class="passkey-list__actions">
                    <template v-if="renamingId === pk.id">
                      <WinButton Style="SubtleButtonStyle" @Click="submitRename(pk)">保存</WinButton>
                      <WinButton Style="SubtleButtonStyle" @Click="renamingId = null">取消</WinButton>
                    </template>
                    <template v-else>
                      <WinButton Style="SubtleButtonStyle" @Click="startRename(pk)">重命名</WinButton>
                      <WinButton Style="SubtleButtonStyle" @Click="deletePasskey(pk)">
                        <AppIcon name="delete" :size="15" />
                      </WinButton>
                    </template>
                  </div>
                </li>
              </ul>
              <p v-else class="security-section__empty">还没有添加任何通行密钥</p>

              <div v-if="addingPasskey" class="passkey-add-form">
                <input
                  v-model="newPasskeyName"
                  class="passkey-add-form__input"
                  type="text"
                  maxlength="40"
                  placeholder="给这个通行密钥起个名字，例如「我的笔记本」"
                  @keyup.enter="submitAddPasskey"
                />
                <p v-if="addPasskeyError" class="field__error">{{ addPasskeyError }}</p>
                <div class="passkey-add-form__actions">
                  <WinButton Style="AccentButtonStyle" :IsEnabled="!addPasskeyBusy" @Click="submitAddPasskey">
                    {{ addPasskeyBusy ? '等待设备确认…' : '开始注册' }}
                  </WinButton>
                  <WinButton Style="SubtleButtonStyle" @Click="cancelAddPasskey">取消</WinButton>
                </div>
              </div>
              <WinButton v-else Style="DefaultButtonStyle" @Click="startAddPasskey">添加通行密钥</WinButton>
            </section>

            <!-- TOTP -->
            <section v-else class="security-section">
              <template v-if="totpStep === 'status'">
                <p class="security-section__hint">
                  启用两步验证后，使用密码登录时需额外输入验证器 App 生成的 6 位一次性验证码。
                </p>
                <WinInfoBar :IsOpen="true" :IsClosable="false" :IsIconVisible="false" :Severity="totpEnabled ? 'Success' : 'Informational'">
                  {{ totpEnabled ? '两步验证已启用' : '两步验证未启用' }}
                </WinInfoBar>
                <WinButton v-if="!totpEnabled" Style="AccentButtonStyle" :IsEnabled="!totpBusy" @Click="beginTotpSetup">
                  {{ totpBusy ? '准备中…' : '启用两步验证' }}
                </WinButton>
                <WinButton v-else Style="DefaultButtonStyle" @Click="beginTotpDisable">禁用两步验证</WinButton>
                <p v-if="totpError" class="field__error">{{ totpError }}</p>
              </template>

              <template v-else-if="totpStep === 'setup-scan'">
                <p class="security-section__hint">用验证器 App 扫描下方二维码，或手动输入密钥。</p>
                <img v-if="totpQrDataUrl" :src="totpQrDataUrl" alt="TOTP 二维码" class="totp-qr" />
                <p class="totp-secret">{{ totpSecret }}</p>
                <div class="passkey-add-form__actions">
                  <WinButton Style="AccentButtonStyle" @Click="goToVerify">下一步</WinButton>
                  <WinButton Style="SubtleButtonStyle" @Click="cancelTotpFlow">取消</WinButton>
                </div>
              </template>

              <template v-else-if="totpStep === 'setup-verify'">
                <p class="security-section__hint">输入验证器 App 当前显示的 6 位验证码以完成激活。</p>
                <div class="field">
                  <label class="field__label" for="totp-activate-code">验证码</label>
                  <input
                    id="totp-activate-code"
                    v-model="totpCode"
                    type="text"
                    inputmode="numeric"
                    pattern="[0-9]{6}"
                    maxlength="6"
                    autocomplete="one-time-code"
                    @keyup.enter="submitTotpActivate"
                  />
                </div>
                <p v-if="totpError" class="field__error">{{ totpError }}</p>
                <div class="passkey-add-form__actions">
                  <WinButton Style="AccentButtonStyle" :IsEnabled="!totpBusy" @Click="submitTotpActivate">
                    {{ totpBusy ? '验证中…' : '确认激活' }}
                  </WinButton>
                  <WinButton Style="SubtleButtonStyle" @Click="cancelTotpFlow">取消</WinButton>
                </div>
              </template>

              <template v-else-if="totpStep === 'disable'">
                <p class="security-section__hint">输入当前密码与验证码以禁用两步验证。</p>
                <div class="field">
                  <label class="field__label" for="totp-disable-password">当前密码</label>
                  <input id="totp-disable-password" v-model="disableForm.password" type="password" autocomplete="current-password" />
                </div>
                <div class="field">
                  <label class="field__label" for="totp-disable-code">验证码</label>
                  <input
                    id="totp-disable-code"
                    v-model="disableForm.code"
                    type="text"
                    inputmode="numeric"
                    pattern="[0-9]{6}"
                    maxlength="6"
                    autocomplete="one-time-code"
                  />
                </div>
                <p v-if="totpError" class="field__error">{{ totpError }}</p>
                <div class="passkey-add-form__actions">
                  <WinButton Style="AccentButtonStyle" :IsEnabled="!totpBusy" @Click="submitTotpDisable">
                    {{ totpBusy ? '提交中…' : '确认禁用' }}
                  </WinButton>
                  <WinButton Style="SubtleButtonStyle" @Click="cancelTotpFlow">取消</WinButton>
                </div>
              </template>
            </section>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.security-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: rgba(0, 0, 0, 0.5);
}

.security-modal {
  position: relative;
  width: 100%;
  max-width: 440px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-md);
  background: var(--flyout-bg, var(--layer-default));
  border: 1px solid var(--card-stroke);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(32px) saturate(160%);
  -webkit-backdrop-filter: blur(32px) saturate(160%);
  overflow: hidden;
}

.security-modal-enter-active,
.security-modal-leave-active {
  transition: opacity var(--normal-duration) var(--fast-out-slow-in);
}

.security-modal-enter-active .security-modal,
.security-modal-leave-active .security-modal {
  transition:
    opacity var(--normal-duration) var(--fast-out-slow-in),
    transform var(--normal-duration) var(--fast-out-slow-in);
}

.security-modal-enter-from,
.security-modal-leave-to {
  opacity: 0;
}

.security-modal-enter-from .security-modal,
.security-modal-leave-to .security-modal {
  opacity: 0;
  transform: scale(0.94) translateY(12px);
}

@media (prefers-reduced-motion: reduce) {
  .security-modal-enter-active,
  .security-modal-leave-active,
  .security-modal-enter-active .security-modal,
  .security-modal-leave-active .security-modal {
    transition: none !important;
  }
}

.security-modal__header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 1.1rem 1.1rem 0;
}

.security-modal__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
}

.security-modal__tabs {
  flex: 0 0 auto;
  margin: 0.85rem 1.1rem 0;
  padding: 0.25rem;
  border-radius: var(--radius-sm);
  background: var(--ctrl-fill-secondary);
}

.security-modal__body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 0.9rem 1.1rem 1.1rem;
}

.security-section {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.security-section__hint {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--text-secondary);
}

.security-section__loading,
.security-section__empty {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-tertiary);
}

.passkey-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.passkey-list__item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.65rem;
  border-radius: var(--radius-sm);
  background: var(--ctrl-fill-secondary);
}

.passkey-list__icon {
  flex: 0 0 auto;
  color: var(--text-secondary);
}

.passkey-list__body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.passkey-list__name {
  font-size: 0.86rem;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.passkey-list__meta {
  font-size: 0.72rem;
  color: var(--text-tertiary);
}

.passkey-list__rename-input {
  width: 100%;
}

.passkey-list__actions {
  flex: 0 0 auto;
  display: flex;
  gap: 0.25rem;
}

.passkey-add-form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.passkey-add-form__actions {
  display: flex;
  gap: 0.5rem;
}

.totp-qr {
  width: 180px;
  height: 180px;
  align-self: center;
  border-radius: var(--radius-sm);
  background: rgb(var(--surface-fixed-light));
  padding: 0.5rem;
}

.totp-secret {
  align-self: center;
  font-family: ui-monospace, monospace;
  font-size: 0.85rem;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  word-break: break-all;
}

@media (max-width: 768px) {
  .security-modal-overlay {
    padding: 0;
  }

  .security-modal {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    border-radius: 0;
    background: var(--dialog-background);
  }
}
</style>
