import { ref } from 'vue'

export type ShellView = 'posts' | 'chat' | 'stronghold'

const activeView = ref<ShellView>('chat')

function setView(view: ShellView) {
  activeView.value = view
}

export function useShellView() {
  return { activeView, setView }
}
