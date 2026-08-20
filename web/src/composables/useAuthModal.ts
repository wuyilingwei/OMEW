import { ref } from 'vue'

// shared singleton: any write-gated affordance in the guest shell (compose
// buttons, the account pill, PostModal's reply box, ...) opens the same
// login/register modal instead of each owning its own open/close state.
const isOpen = ref(false)

function openAuthModal() {
  isOpen.value = true
}

function closeAuthModal() {
  isOpen.value = false
}

export function useAuthModal() {
  return { isOpen, openAuthModal, closeAuthModal }
}
