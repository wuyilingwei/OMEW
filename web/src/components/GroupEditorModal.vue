<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { api } from '../api'
import type { GroupPermValue, ServerGroup } from '../api/types'
import { GROUP_COLOR_SWATCHES } from '../constants/groupColors'
import { useAuth } from '../composables/useAuth'
import { requiredMaxLengthError } from '../utils/validate'
import { WinButton, WinInfoBar, WinSelectorBar, WinToggleSwitch } from '../vendor/winui'

// task 048: server-level group editor (definition only - member assignment
// lives in ServerAdminModal's member rows, not here).
const props = defineProps<{ open: boolean; group: ServerGroup | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const auth = useAuth()

const PERM_OPTIONS: { Text: string; value: GroupPermValue }[] = [
  { Text: '继承', value: 0 },
  { Text: '允许', value: 1 },
  { Text: '拒绝', value: -1 },
]

const form = reactive({
  name: '',
  color: null as string | null,
  allow_speak: 0 as GroupPermValue,
  allow_post: 0 as GroupPermValue,
  allow_reply: 0 as GroupPermValue,
  is_moderator: false,
})

const error = ref('')
const saving = ref(false)

const isEdit = computed(() => props.group !== null)

function resetForm() {
  const g = props.group
  form.name = g?.name ?? ''
  form.color = g?.color ?? null
  form.allow_speak = g?.allow_speak ?? 0
  form.allow_post = g?.allow_post ?? 0
  form.allow_reply = g?.allow_reply ?? 0
  form.is_moderator = g?.is_moderator ?? false
  error.value = ''
}

watch(
  () => props.open,
  (open) => {
    if (open) resetForm()
  },
  { immediate: true },
)

const speakSelected = computed(() => PERM_OPTIONS.find((o) => o.value === form.allow_speak))
const postSelected = computed(() => PERM_OPTIONS.find((o) => o.value === form.allow_post))
const replySelected = computed(() => PERM_OPTIONS.find((o) => o.value === form.allow_reply))

function onSpeakSelect(item: { value: GroupPermValue }) {
  form.allow_speak = item.value
}
function onPostSelect(item: { value: GroupPermValue }) {
  form.allow_post = item.value
}
function onReplySelect(item: { value: GroupPermValue }) {
  form.allow_reply = item.value
}

function isSwatchSelected(hex: string): boolean {
  return form.color?.toLowerCase() === hex.toLowerCase()
}

async function save() {
  error.value = requiredMaxLengthError(form.name, 32, '组名称')
  if (error.value || !auth.token.value || saving.value) return
  saving.value = true
  try {
    const payload = {
      name: form.name,
      color: form.color,
      allow_speak: form.allow_speak,
      allow_post: form.allow_post,
      allow_reply: form.allow_reply,
      is_moderator: form.is_moderator,
    }
    if (isEdit.value && props.group) {
      await api.updateServerGroup(auth.token.value, props.group.id, payload)
    } else {
      await api.createServerGroup(auth.token.value, payload)
    }
    emit('saved')
    emit('close')
  } catch {
    error.value = '保存失败，请稍后重试'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="group-modal">
      <div v-if="open" class="group-modal-overlay" @click.self="$emit('close')">
        <div class="group-modal" role="dialog" aria-modal="true">
          <div class="group-modal__header">
            <h1 class="group-modal__title">{{ isEdit ? '编辑用户组' : '新建用户组' }}</h1>
            <WinButton Style="SubtleButtonStyle" @click="$emit('close')">关闭</WinButton>
          </div>

          <div class="group-modal__form">
            <div class="field">
              <label class="field__label" for="grp-name">名称</label>
              <input id="grp-name" v-model="form.name" type="text" maxlength="32" placeholder="例如：内测成员" />
            </div>

            <div class="field">
              <span class="field__label">颜色</span>
              <div class="group-swatches">
                <button
                  type="button"
                  class="group-swatch group-swatch--none"
                  :class="{ 'is-selected': form.color === null }"
                  title="无颜色"
                  aria-label="无颜色"
                  @click="form.color = null"
                />
                <button
                  v-for="swatch in GROUP_COLOR_SWATCHES"
                  :key="swatch.key"
                  type="button"
                  class="group-swatch"
                  :class="{ 'is-selected': isSwatchSelected(swatch.hex) }"
                  :style="{ backgroundColor: swatch.hex }"
                  :title="swatch.name"
                  :aria-label="swatch.name"
                  :aria-pressed="isSwatchSelected(swatch.hex)"
                  @click="form.color = swatch.hex"
                />
              </div>
            </div>

            <div class="field">
              <span class="field__label">发言（话题）</span>
              <WinSelectorBar class="group-perm-bar" :Items="PERM_OPTIONS" :SelectedItem="speakSelected" @update:SelectedItem="onSpeakSelect" />
            </div>
            <div class="field">
              <span class="field__label">发帖（分区）</span>
              <WinSelectorBar class="group-perm-bar" :Items="PERM_OPTIONS" :SelectedItem="postSelected" @update:SelectedItem="onPostSelect" />
            </div>
            <div class="field">
              <span class="field__label">回帖</span>
              <WinSelectorBar class="group-perm-bar" :Items="PERM_OPTIONS" :SelectedItem="replySelected" @update:SelectedItem="onReplySelect" />
            </div>

            <WinToggleSwitch v-model="form.is_moderator">标记为管理员组</WinToggleSwitch>
            <p class="field__hint">开启后，此组成员在权限合成中按管理员对待。</p>

            <WinInfoBar v-if="error" :IsOpen="true" :IsClosable="false" :IsIconVisible="false" Severity="Error">
              {{ error }}
            </WinInfoBar>

            <WinButton Style="AccentButtonStyle" class="group-modal__submit" :IsEnabled="!saving" @click="save">
              {{ saving ? '保存中…' : '保存' }}
            </WinButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.group-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 55;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: var(--overlay-scrim);
}

.group-modal {
  position: relative;
  width: 100%;
  max-width: 420px;
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

.group-modal-enter-active,
.group-modal-leave-active {
  transition: opacity var(--normal-duration) var(--fast-out-slow-in);
}

.group-modal-enter-active .group-modal,
.group-modal-leave-active .group-modal {
  transition:
    opacity var(--normal-duration) var(--fast-out-slow-in),
    transform var(--normal-duration) var(--fast-out-slow-in);
}

.group-modal-enter-from,
.group-modal-leave-to {
  opacity: 0;
}

.group-modal-enter-from .group-modal,
.group-modal-leave-to .group-modal {
  opacity: 0;
  transform: scale(0.94) translateY(12px);
}

@media (prefers-reduced-motion: reduce) {
  .group-modal-enter-active,
  .group-modal-leave-active,
  .group-modal-enter-active .group-modal,
  .group-modal-leave-active .group-modal {
    transition: none !important;
  }
}

.group-modal__header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 1.1rem 1.1rem 0;
}

.group-modal__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
}

.group-modal__form {
  flex: 1 1 auto;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 0.9rem 1.1rem 1.1rem;
}

.group-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.group-swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  padding: 0;
  cursor: pointer;
  box-shadow: 0 0 0 1px var(--card-stroke) inset;
}

.group-swatch--none {
  background: repeating-conic-gradient(var(--ctrl-fill-tertiary) 0% 25%, transparent 0% 50%) 50% / 10px 10px;
}

.group-swatch.is-selected {
  border-color: rgb(var(--colors-primary));
  box-shadow: 0 0 0 2px var(--card-bg), 0 0 0 4px rgb(var(--colors-primary));
}

.group-perm-bar {
  align-self: flex-start;
  border-radius: var(--radius-sm);
  background: var(--ctrl-fill-secondary);
  padding: 0.15rem;
}

.group-modal__submit {
  width: 100%;
  justify-content: center;
  margin-top: 0.15rem;
}

@media (max-width: 768px) {
  .group-modal-overlay {
    padding: 0;
  }

  .group-modal {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    border-radius: 0;
    background: var(--dialog-background);
  }
}
</style>
