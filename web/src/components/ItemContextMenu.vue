<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { BUILTIN_REACTION_SET } from '../assets/mew-emotes'
import { WinMenuFlyout } from '../vendor/winui'

// Right-click/long-press menu shared by chat messages, post bodies and post
// replies (see useContextMenuGesture for the open-gesture wiring). Always
// renders through WinMenuFlyout's default slot with an empty `Items` array
// instead of its built-in Items/Select flow - that flow auto-closes the
// flyout on every selection, which would fight the picker's own open state
// when 添加反应 is chosen without closing the menu.
const props = defineProps<{ canReact: boolean; canEdit: boolean; canRetract: boolean; mine?: string[] }>()
const emit = defineEmits<{ 'add-reaction': [name: string]; edit: []; retract: [] }>()

const open = ref(false)
const showPicker = ref(false)
const anchorRect = ref<{ top: number; left: number; right: number; bottom: number; width: number; height: number } | null>(null)

const reactionNames = Object.keys(BUILTIN_REACTION_SET)

function close() {
  open.value = false
  showPicker.value = false
}

// WinMenuFlyout estimates its own popup height from `Items` (always [] here,
// since this menu renders through the default slot) and gets it badly wrong
// for the actual content - openAt() below works around that by estimating a
// real size from this component's own CSS metrics and clamping/flipping the
// anchor itself instead of trusting WinMenuFlyout's placement math.
const PICKER_COLS = 4
const PICKER_CELL = 40 // .item-context-menu__picker-item
const PICKER_GAP = 4.8 // 0.3rem
const PICKER_PAD = 6.4 // 0.4rem, one side
const LIST_ITEM_HEIGHT = 36 // .win-menu-flyout-item: 32px min-height + 2*2px margin
const CHROME = 16 // WinMenuFlyout's own border + padding around the slot
const MENU_GAP = 6 // matches WinMenuFlyout's default Gap prop
const VIEWPORT_MARGIN = 8

function estimateMenuSize(): { width: number; height: number } {
  const rows = Math.ceil(reactionNames.length / PICKER_COLS)
  const pickerWidth = PICKER_COLS * PICKER_CELL + (PICKER_COLS - 1) * PICKER_GAP + PICKER_PAD * 2
  const pickerHeight = rows * PICKER_CELL + (rows - 1) * PICKER_GAP + PICKER_PAD * 2
  const itemCount = [props.canReact, props.canEdit, props.canRetract].filter(Boolean).length
  const listHeight = itemCount * LIST_ITEM_HEIGHT
  // sized for whichever sub-view (item list or reaction picker) is bigger, so
  // switching between them after opening never needs a repositioning jump.
  return { width: Math.max(160, pickerWidth) + CHROME, height: Math.max(listHeight, pickerHeight) + CHROME }
}

function openAt(x: number, y: number) {
  if (!props.canReact && !props.canEdit && !props.canRetract) return
  const { width: menuW, height: menuH } = estimateMenuSize()
  const vw = window.innerWidth
  const vh = window.innerHeight

  const desiredLeft = x - menuW / 2
  const clampedLeft = Math.min(Math.max(desiredLeft, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vw - menuW - VIEWPORT_MARGIN))
  const left = clampedLeft + menuW / 2

  const spaceBelow = vh - y - MENU_GAP - VIEWPORT_MARGIN
  const spaceAbove = y - MENU_GAP - VIEWPORT_MARGIN
  const opensUp = spaceBelow < menuH && (spaceAbove >= menuH || spaceAbove > spaceBelow)

  anchorRect.value = {
    top: y,
    left,
    right: left,
    // WinMenuFlyout picks its own up/down direction from `spaceBelow` vs. its
    // (wrong) Items-based height guess, which is small enough that it always
    // reads as "fits below". Pushing `bottom` past the viewport when we've
    // decided to flip up forces that comparison to fail on its own terms,
    // without touching the up-branch math (which only reads `top`, so the
    // visual anchor stays the real pointer position).
    bottom: opensUp ? vh + menuH : y,
    width: 0,
    height: 0,
  }
  showPicker.value = false
  open.value = true
}

function pick(name: string) {
  emit('add-reaction', name)
  close()
}

function onEditClick() {
  emit('edit')
  close()
}

function onRetractClick() {
  emit('retract')
  close()
}

// WinMenuFlyout's own Escape handling only fires from inside its built-in
// Items renderer (unused here, see the note above) - this menu's slot
// content needs its own Escape-to-dismiss independent of focus.
function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

watch(open, (value) => {
  if (value) window.addEventListener('keydown', onWindowKeydown)
  else window.removeEventListener('keydown', onWindowKeydown)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))

defineExpose({ openAt })
</script>

<template>
  <WinMenuFlyout :Open="open" :AnchorRect="anchorRect" :Items="[]" Placement="Bottom" @Close="close">
    <div class="item-context-menu">
      <div v-if="!showPicker" role="menu" class="win-menu-flyout-items">
        <button v-if="canReact" type="button" class="win-menu-flyout-item" role="menuitem" @click="showPicker = true">
          <span class="win-menu-flyout-label">添加反应</span>
        </button>
        <button v-if="canEdit" type="button" class="win-menu-flyout-item" role="menuitem" @click="onEditClick">
          <span class="win-menu-flyout-label">编辑</span>
        </button>
        <button v-if="canRetract" type="button" class="win-menu-flyout-item" role="menuitem" @click="onRetractClick">
          <span class="win-menu-flyout-label">撤回</span>
        </button>
      </div>
      <div v-else class="item-context-menu__picker">
        <button
          v-for="name in reactionNames"
          :key="name"
          type="button"
          class="item-context-menu__picker-item"
          :class="{ 'item-context-menu__picker-item--mine': mine?.includes(name) }"
          :title="name"
          @click="pick(name)"
        >
          <img :src="BUILTIN_REACTION_SET[name]" :alt="name" />
        </button>
      </div>
    </div>
  </WinMenuFlyout>
</template>

<style scoped>
.item-context-menu {
  min-width: 160px;
}

.item-context-menu__picker {
  display: grid;
  grid-template-columns: repeat(4, 40px);
  gap: 0.3rem;
  padding: 0.4rem;
}

.item-context-menu__picker-item {
  width: 40px;
  height: 40px;
  padding: 0.3rem;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  background: var(--ctrl-fill-secondary);
  transition: background var(--fast-duration) var(--fast-out-slow-in);
}

.item-context-menu__picker-item:hover {
  background: var(--ctrl-fill-tertiary);
}

.item-context-menu__picker-item--mine {
  border-color: rgb(var(--colors-primary));
  background: color-mix(in srgb, rgb(var(--colors-primary)) 16%, var(--ctrl-fill-secondary));
}

.item-context-menu__picker-item img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
