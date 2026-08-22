<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useAuthModal } from '../composables/useAuthModal'
import { WinButton } from '../vendor/winui'
import AuthForm from './AuthForm.vue'

// popup form of AuthGate's content (task 034: guest shell moves login/register
// off the full-screen gate and into this modal, opened from the account pill).
// Same overlay/panel shell family as ComposePostModal.

const auth = useAuth()
const { isOpen, closeAuthModal } = useAuthModal()
const authForm = ref<InstanceType<typeof AuthForm> | null>(null)

function requestClose() {
  if (authForm.value?.hasPendingBackup && !confirm('还没有导出所有权密钥备份，确定关闭？')) return
  closeAuthModal()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && isOpen.value) requestClose()
}

// login/register success flips isAuthenticated - close the modal and let
// useStronghold's own watcher pick up the now-authenticated data source.
watch(auth.isAuthenticated, (authenticated) => {
  if (authenticated) closeAuthModal()
})

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="auth-modal">
      <div v-if="isOpen" class="auth-modal-overlay" @click.self="requestClose">
        <div class="auth-modal" role="dialog" aria-modal="true">
          <div class="auth-modal__header">
            <WinButton Style="SubtleButtonStyle" @click="requestClose">关闭</WinButton>
          </div>
          <div class="auth-modal__scroll">
            <AuthForm ref="authForm" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.auth-modal-overlay {
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
  background: var(--overlay-scrim);
}

.auth-modal {
  position: relative;
  width: 100%;
  max-width: 400px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-md);
  background: var(--flyout-bg, var(--layer-default));
  border: 1px solid var(--card-stroke);
  box-shadow: var(--shadow-dialog);
  backdrop-filter: blur(32px) saturate(160%);
  -webkit-backdrop-filter: blur(32px) saturate(160%);
  overflow: hidden;
}

.auth-modal-enter-active,
.auth-modal-leave-active {
  transition: opacity var(--normal-duration) var(--fast-out-slow-in);
}

.auth-modal-enter-active .auth-modal,
.auth-modal-leave-active .auth-modal {
  transition:
    opacity var(--normal-duration) var(--fast-out-slow-in),
    transform var(--normal-duration) var(--fast-out-slow-in);
}

.auth-modal-enter-from,
.auth-modal-leave-to {
  opacity: 0;
}

.auth-modal-enter-from .auth-modal,
.auth-modal-leave-to .auth-modal {
  opacity: 0;
  transform: scale(0.94) translateY(12px);
}

@media (prefers-reduced-motion: reduce) {
  .auth-modal-enter-active,
  .auth-modal-leave-active,
  .auth-modal-enter-active .auth-modal,
  .auth-modal-leave-active .auth-modal {
    transition: none !important;
  }
}

.auth-modal__header {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  padding: 0.6rem 0.6rem 0;
}

.auth-modal__scroll {
  flex: 1 1 auto;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  padding: 0 2rem 2rem;
}

@media (max-width: 768px) {
  .auth-modal-overlay {
    padding: 0;
  }

  .auth-modal {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    border-radius: 0;
    background: var(--dialog-background);
  }
}
</style>
