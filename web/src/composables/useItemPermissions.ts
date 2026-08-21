import { useAuth } from './useAuth'
import { useStrongholdConfig } from './useStrongholdConfig'

// shared by ChatPane (messages) and PostModal (posts/replies) - a single
// stronghold-wide edit/retract policy gates the context menu's 编辑/撤回
// items on every item surface, not just chat.
export function useItemPermissions() {
  const auth = useAuth()
  const { config } = useStrongholdConfig()

  function withinWindow(ts: number): boolean {
    const windowSecs = config.value?.edit_window_secs ?? 0
    return windowSecs <= 0 || (Date.now() - ts) / 1000 <= windowSecs
  }

  function canEdit(actor: string, ts: number): boolean {
    if (actor !== auth.user.value?.actor || !config.value?.allow_message_edit) return false
    return withinWindow(ts)
  }

  function canRetract(actor: string, ts: number): boolean {
    if (actor !== auth.user.value?.actor || !config.value?.allow_message_retract) return false
    return withinWindow(ts)
  }

  return { canEdit, canRetract }
}
