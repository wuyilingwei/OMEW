<script setup lang="ts">
import { computed, ref } from 'vue'
import { api, ApiRequestError } from '../api'
import type { RoomSummary } from '../api/types'
import { useAuth } from '../composables/useAuth'
import { useStronghold } from '../composables/useStronghold'
import { maxLengthError, requiredMaxLengthError } from '../utils/validate'
import { WinButton } from '../vendor/winui'
import AppIcon from './icons/AppIcon.vue'

// 据点管理面板「分区」tab：section 型房间的增删改名排序（StrongholdAdminModal 内嵌）。
const auth = useAuth()
const { currentNode, selectedNodeId, loadStrongholds } = useStronghold()

const sections = computed(() => (currentNode.value?.rooms ?? []).filter((r) => r.type === 'section'))

const busy = ref(false)
const listError = ref('')

const editingId = ref<string | null>(null)
const editingName = ref('')
const editingDescription = ref('')
const editError = ref('')
const descError = ref('')

function startEdit(room: RoomSummary) {
  editingId.value = room.id
  editingName.value = room.name
  editingDescription.value = room.description ?? ''
  editError.value = ''
  descError.value = ''
}

function cancelEdit() {
  editingId.value = null
  editError.value = ''
  descError.value = ''
}

async function saveEdit(room: RoomSummary) {
  if (!auth.token.value) return
  editError.value = requiredMaxLengthError(editingName.value, 32, '名称')
  descError.value = maxLengthError(editingDescription.value, 64, '描述')
  if (editError.value || descError.value) return
  busy.value = true
  try {
    await api.patchRoom(auth.token.value, selectedNodeId.value, room.id, {
      name: editingName.value.trim(),
      description: editingDescription.value.trim() || null,
    })
    await loadStrongholds(true)
    editingId.value = null
  } catch {
    editError.value = '保存失败，请稍后重试'
  } finally {
    busy.value = false
  }
}

async function reorder(list: RoomSummary[]) {
  const token = auth.token.value
  if (!token) return
  busy.value = true
  listError.value = ''
  try {
    // 房间的 position 可以为空（建房间时不设），只改被交换/拖动的两项会让它们排到未设过的
    // 房间之后，所以每次排序都按下标重写整列。
    await Promise.all(list.map((r, i) => api.patchRoom(token, selectedNodeId.value, r.id, { position: i })))
    await loadStrongholds(true)
  } catch {
    listError.value = '排序失败，请稍后重试'
  } finally {
    busy.value = false
  }
}

async function move(room: RoomSummary, dir: -1 | 1) {
  const list = [...sections.value]
  const idx = list.findIndex((r) => r.id === room.id)
  const swap = idx + dir
  if (idx < 0 || swap < 0 || swap >= list.length) return
  ;[list[idx], list[swap]] = [list[swap]!, list[idx]!]
  await reorder(list)
}

// ---- drag reorder (desktop only, ≤768px 断点回退到上下移按钮) ----
const dragFromIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

function onDragStart(idx: number, ev: DragEvent) {
  dragFromIndex.value = idx
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = 'move'
    ev.dataTransfer.setData('text/plain', String(idx))
  }
}

function onDragOver(idx: number, ev: DragEvent) {
  ev.preventDefault()
  dragOverIndex.value = idx
}

function onDragLeave(idx: number) {
  if (dragOverIndex.value === idx) dragOverIndex.value = null
}

function onDragEnd() {
  dragFromIndex.value = null
  dragOverIndex.value = null
}

async function onDrop(idx: number, ev: DragEvent) {
  ev.preventDefault()
  const from = dragFromIndex.value
  dragFromIndex.value = null
  dragOverIndex.value = null
  if (from === null || from === idx) return
  const list = [...sections.value]
  const [moved] = list.splice(from, 1)
  if (!moved) return
  list.splice(idx, 0, moved)
  await reorder(list)
}

async function remove(room: RoomSummary) {
  if (!auth.token.value) return
  if (!confirm(`删除分区「${room.name}」？其中的帖子将一并移除，此操作不可撤销。`)) return
  busy.value = true
  listError.value = ''
  try {
    await api.deleteRoom(auth.token.value, selectedNodeId.value, room.id)
    await loadStrongholds(true)
  } catch (err) {
    listError.value = err instanceof ApiRequestError && err.code === 'LAST_ROOM_OF_TYPE' ? '至少保留一个分区' : '删除失败，请稍后重试'
  } finally {
    busy.value = false
  }
}

// ---- create ----
const newName = ref('')
const createError = ref('')
const creating = ref(false)

async function create() {
  if (!auth.token.value) return
  createError.value = requiredMaxLengthError(newName.value, 32, '名称')
  if (createError.value) return
  creating.value = true
  try {
    await api.createRoom(auth.token.value, selectedNodeId.value, { name: newName.value.trim(), type: 'section' })
    await loadStrongholds(true)
    newName.value = ''
  } catch {
    createError.value = '创建失败，请稍后重试'
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="section-manager">
    <p v-if="listError" class="field__error">{{ listError }}</p>
    <p v-if="!sections.length" class="field__hint">暂无分区</p>

    <ul v-else class="section-list">
      <li
        v-for="(room, idx) in sections"
        :key="room.id"
        class="section-row"
        :class="{ 'section-row--drag-over': dragOverIndex === idx, 'section-row--dragging': dragFromIndex === idx }"
        @dragover="onDragOver(idx, $event)"
        @dragleave="onDragLeave(idx)"
        @drop="onDrop(idx, $event)"
      >
        <span
          class="drag-handle only-desktop"
          draggable="true"
          title="拖拽排序"
          @dragstart="onDragStart(idx, $event)"
          @dragend="onDragEnd"
        >
          <span class="drag-handle__bar" /><span class="drag-handle__bar" /><span class="drag-handle__bar" />
        </span>
        <template v-if="editingId === room.id">
          <div class="field section-row__edit">
            <input v-model="editingName" type="text" maxlength="32" @keyup.enter="saveEdit(room)" @keyup.escape="cancelEdit" />
            <p v-if="editError" class="field__error">{{ editError }}</p>
            <input v-model="editingDescription" type="text" maxlength="64" placeholder="分区描述（可选，≤64 字）" @keyup.enter="saveEdit(room)" @keyup.escape="cancelEdit" />
            <p v-if="descError" class="field__error">{{ descError }}</p>
          </div>
          <div class="section-row__actions">
            <WinButton Style="AccentButtonStyle" :IsEnabled="!busy" @Click="saveEdit(room)">保存</WinButton>
            <WinButton Style="SubtleButtonStyle" :IsEnabled="!busy" @Click="cancelEdit">取消</WinButton>
          </div>
        </template>
        <template v-else>
          <div class="section-row__info">
            <span class="section-row__name">{{ room.name }}</span>
            <span class="section-row__desc" :class="{ 'section-row__desc--empty': !room.description }">
              {{ room.description || '暂无描述' }}
            </span>
          </div>
          <span class="section-row__count">{{ room.post_count ?? 0 }} 篇帖子</span>
          <div class="section-row__actions">
            <button type="button" class="icon-btn only-mobile" title="上移" :disabled="busy || idx === 0" @click="move(room, -1)">
              <AppIcon name="chevron-right" :size="16" class="icon-btn__rotate-up" />
            </button>
            <button
              type="button"
              class="icon-btn only-mobile"
              title="下移"
              :disabled="busy || idx === sections.length - 1"
              @click="move(room, 1)"
            >
              <AppIcon name="chevron-right" :size="16" class="icon-btn__rotate-down" />
            </button>
            <WinButton Style="SubtleButtonStyle" :IsEnabled="!busy" @Click="startEdit(room)">重命名</WinButton>
            <WinButton Style="SubtleButtonStyle" class="win-btn--danger" :IsEnabled="!busy" @Click="remove(room)">删除</WinButton>
          </div>
        </template>
      </li>
    </ul>

    <div class="section-create">
      <div class="field section-create__field">
        <input v-model="newName" type="text" maxlength="32" placeholder="新建分区名称" @keyup.enter="create" />
        <p v-if="createError" class="field__error">{{ createError }}</p>
      </div>
      <WinButton Style="DefaultButtonStyle" :IsEnabled="!creating" @Click="create">
        {{ creating ? '创建中…' : '新建分区' }}
      </WinButton>
    </div>
  </div>
</template>

<style scoped>
.section-manager {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.section-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  padding: 0.65rem 0.85rem;
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
}

.section-row__info {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.section-row__name {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-row__desc {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-row__desc--empty {
  font-style: italic;
}

.section-row__count {
  flex: 0 0 auto;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.section-row__edit {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.section-row__edit input + input {
  margin-top: 0.1rem;
}

.section-row__actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: auto;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-sm);
  background: var(--ctrl-fill-secondary);
  color: var(--text-secondary);
  cursor: pointer;
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.icon-btn__rotate-up {
  transform: rotate(-90deg);
}

.icon-btn__rotate-down {
  transform: rotate(90deg);
}

.section-create {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding-top: 0.4rem;
  border-top: 1px solid var(--card-stroke);
}

.section-create__field {
  flex: 1 1 auto;
  margin: 0;
}

.drag-handle {
  display: inline-flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: 20px;
  height: 28px;
  cursor: grab;
}

.drag-handle__bar {
  width: 14px;
  height: 2px;
  border-radius: 1px;
  background: var(--text-tertiary);
}

.section-row--drag-over {
  border-color: rgb(var(--colors-primary));
  background: var(--card-bg-secondary);
}

.section-row--dragging {
  opacity: 0.5;
}

.only-mobile {
  display: none;
}

@media (max-width: 768px) {
  .only-desktop {
    display: none !important;
  }

  .only-mobile {
    display: inline-flex !important;
  }
}
</style>
