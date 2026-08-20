<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { api, ApiRequestError } from '../api'
import { useAuth } from '../composables/useAuth'
import { envelopeToCiphertextField, parseOwnershipEnvelope, resealOwnershipKey, unsealOwnershipKey } from '../crypto/ownershipKey'
import { passwordError, requiredError } from '../utils/validate'
import { WinButton, WinInfoBar } from '../vendor/winui'

// m0-protocol §7.9a: when the custody passphrase defaults to the login
// password, a password change must re-wrap the custody ciphertext too, or the
// old password silently keeps unlocking it forever. Best-effort: fetch the
// envelope, try to unseal it with the old password, and if that works reseal
// under the new one and submit alongside the password change. Any failure
// along this path (fetch, parse, wrong-passphrase unseal) just means "this
// account uses an independent custody passphrase" - the ciphertext is left
// untouched and only the login password changes.
async function rewrapOwnershipCiphertext(token: string, oldPassword: string, newPassword: string): Promise<string | undefined> {
  try {
    const { ownership_ciphertext } = await api.getOwnership(token)
    if (!ownership_ciphertext) return undefined
    const envelope = parseOwnershipEnvelope(ownership_ciphertext)
    const secretKey = await unsealOwnershipKey(oldPassword, envelope)
    if (!secretKey) return undefined
    const resealed = await resealOwnershipKey(secretKey, newPassword)
    return envelopeToCiphertextField(resealed)
  } catch {
    return undefined
  }
}

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const auth = useAuth()
const form = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })
const error = ref('')
const success = ref(false)
const busy = ref(false)

function resetForm() {
  form.oldPassword = ''
  form.newPassword = ''
  form.confirmPassword = ''
  error.value = ''
  success.value = false
}

function requestClose() {
  resetForm()
  emit('close')
}

async function submit() {
  success.value = false
  const errors = [requiredError(form.oldPassword, '当前密码'), passwordError(form.newPassword)].filter(Boolean)
  if (form.newPassword !== form.confirmPassword) errors.push('两次输入的新密码不一致')
  error.value = errors.join('；')
  if (error.value || !auth.token.value) return
  busy.value = true
  try {
    const newOwnershipCiphertext = await rewrapOwnershipCiphertext(auth.token.value, form.oldPassword, form.newPassword)
    await api.changePassword(auth.token.value, {
      old_password: form.oldPassword,
      new_password: form.newPassword,
      ...(newOwnershipCiphertext ? { new_ownership_ciphertext: newOwnershipCiphertext } : {}),
    })
    success.value = true
    form.oldPassword = ''
    form.newPassword = ''
    form.confirmPassword = ''
  } catch (err) {
    error.value = err instanceof ApiRequestError && err.code === 'AUTH_FAILED' ? '当前密码不正确' : '修改失败，请稍后重试'
  } finally {
    busy.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) requestClose()
}

watch(
  () => props.open,
  (open) => {
    if (open) resetForm()
  },
)

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="password-modal">
      <div v-if="open" class="password-modal-overlay" @click.self="requestClose">
        <div class="password-modal" role="dialog" aria-modal="true">
          <div class="password-modal__header">
            <h1 class="password-modal__title">修改密码</h1>
            <WinButton Style="SubtleButtonStyle" @Click="requestClose">关闭</WinButton>
          </div>
          <form class="password-modal__form" @submit.prevent="submit">
            <div class="field">
              <label class="field__label" for="pw-old">当前密码</label>
              <input id="pw-old" v-model="form.oldPassword" type="password" autocomplete="current-password" required />
            </div>
            <div class="field">
              <label class="field__label" for="pw-new">新密码</label>
              <input id="pw-new" v-model="form.newPassword" type="password" autocomplete="new-password" minlength="10" required />
            </div>
            <div class="field">
              <label class="field__label" for="pw-confirm">确认新密码</label>
              <input
                id="pw-confirm"
                v-model="form.confirmPassword"
                type="password"
                autocomplete="new-password"
                minlength="10"
                required
              />
            </div>
            <WinInfoBar v-if="error" :IsOpen="true" :IsClosable="false" :IsIconVisible="false" Severity="Error">
              {{ error }}
            </WinInfoBar>
            <WinInfoBar v-if="success" :IsOpen="true" :IsClosable="false" :IsIconVisible="false" Severity="Success">
              密码已更新
            </WinInfoBar>
            <WinButton Style="AccentButtonStyle" class="password-modal__submit" type="submit" :IsEnabled="!busy">
              {{ busy ? '提交中…' : '确认修改' }}
            </WinButton>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.password-modal-overlay {
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

.password-modal {
  position: relative;
  width: 100%;
  max-width: 380px;
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

.password-modal-enter-active,
.password-modal-leave-active {
  transition: opacity var(--normal-duration) var(--fast-out-slow-in);
}

.password-modal-enter-active .password-modal,
.password-modal-leave-active .password-modal {
  transition:
    opacity var(--normal-duration) var(--fast-out-slow-in),
    transform var(--normal-duration) var(--fast-out-slow-in);
}

.password-modal-enter-from,
.password-modal-leave-to {
  opacity: 0;
}

.password-modal-enter-from .password-modal,
.password-modal-leave-to .password-modal {
  opacity: 0;
  transform: scale(0.94) translateY(12px);
}

@media (prefers-reduced-motion: reduce) {
  .password-modal-enter-active,
  .password-modal-leave-active,
  .password-modal-enter-active .password-modal,
  .password-modal-leave-active .password-modal {
    transition: none !important;
  }
}

.password-modal__header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 1.1rem 1.1rem 0;
}

.password-modal__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
}

.password-modal__form {
  flex: 1 1 auto;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 0.9rem 1.1rem 1.1rem;
}

.password-modal__submit {
  width: 100%;
  justify-content: center;
  margin-top: 0.15rem;
}

@media (max-width: 768px) {
  .password-modal-overlay {
    padding: 0;
  }

  .password-modal {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    border-radius: 0;
  }
}
</style>
