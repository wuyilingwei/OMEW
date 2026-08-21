// Right-click (desktop) or long-press (mobile) trigger for ItemContextMenu.
// A single composable so MessageBubble / PostModal's post body / PostModal's
// replies all get identical open-gesture behavior.
const MOBILE_BREAKPOINT = 768
const LONG_PRESS_MS = 500
const MOVE_TOLERANCE_PX = 10

// a non-collapsed selection means the user is mid-copy - yielding to the
// native context menu here keeps copy available instead of always replacing
// it with this item's menu.
function hasTextSelection(): boolean {
  const selection = window.getSelection()
  return !!selection && !selection.isCollapsed && selection.toString().length > 0
}

export function useContextMenuGesture(onOpen: (x: number, y: number) => void, canOpen: () => boolean) {
  let pressTimer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0

  function clearPressTimer() {
    if (pressTimer != null) {
      clearTimeout(pressTimer)
      pressTimer = null
    }
  }

  function onContextMenu(event: MouseEvent) {
    // nothing this menu could show (guest, no permission, still-optimistic
    // item), or the user has text selected - let the native menu through
    // instead of eating the gesture with preventDefault.
    if (!canOpen() || hasTextSelection()) return
    event.preventDefault()
    onOpen(event.clientX, event.clientY)
  }

  function onTouchStart(event: TouchEvent) {
    clearPressTimer()
    if (window.innerWidth > MOBILE_BREAKPOINT || event.touches.length !== 1) return
    const touch = event.touches[0]!
    startX = touch.clientX
    startY = touch.clientY
    pressTimer = setTimeout(() => {
      pressTimer = null
      onOpen(startX, startY)
    }, LONG_PRESS_MS)
  }

  function onTouchMove(event: TouchEvent) {
    if (pressTimer == null) return
    const touch = event.touches[0]
    if (!touch) return
    if (Math.abs(touch.clientX - startX) > MOVE_TOLERANCE_PX || Math.abs(touch.clientY - startY) > MOVE_TOLERANCE_PX) clearPressTimer()
  }

  function onTouchEnd() {
    clearPressTimer()
  }

  function onTouchCancel() {
    clearPressTimer()
  }

  return { onContextMenu, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }
}
