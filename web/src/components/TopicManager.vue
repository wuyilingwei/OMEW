<script setup lang="ts">
import { ref } from 'vue'
import { api, ApiRequestError } from '../api'
import type { Topic } from '../api/types'
import { useAuth } from '../composables/useAuth'
import { useStronghold } from '../composables/useStronghold'
import { useTopics } from '../composables/useTopics'
import { GROUP_COLOR_SWATCHES } from '../constants/groupColors'
import { maxLengthError, requiredMaxLengthError } from '../utils/validate'
import { WinButton } from '../vendor/winui'
import AppIcon from './icons/AppIcon.vue'

// 据点管理面板「话题」tab：据点共用话题池的增删改名配色排序（StrongholdAdminModal 内嵌）。
const TOPIC_LIMIT = 32

const auth = useAuth()
const { selectedNodeId } = useStronghold()
const { topics, topicsLoading, reloadTopics } = useTopics()

const busy = ref(false)
const listError = ref('')

const editingId = ref<string | null>(null)
const editingName = ref('')
const editingColor = ref<string | null>(null)
const editingDescription = ref('')
const editError = ref('')
const descError = ref('')

function startEdit(topic: Topic) {
  editingId.value = topic.id
  editingName.value = topic.name
  editingColor.value = topic.color
  editingDescription.value = topic.description ?? ''
  editError.value = ''
  descError.value = ''
}

function cancelEdit() {
  editingId.value = null
  editError.value = ''
  descError.value = ''
}

async function saveEdit(topic: Topic) {
  if (!auth.token.value) return
  editError.value = requiredMaxLengthError(editingName.value, 16, '话题名称')
  descError.value = maxLengthError(editingDescription.value, 64, '描述')
  if (editError.value || descError.value) return
  busy.value = true
  try {
    await api.patchTopic(auth.token.value, selectedNodeId.value, topic.id, {
      name: editingName.value.trim(),
      color: editingColor.value,
      description: editingDescription.value.trim() || null,
    })
    await reloadTopics()
    editingId.value = null
  } catch (err) {
    editError.value = err instanceof ApiRequestError && err.code === 'ALREADY_EXISTS' ? '话题名称已存在' : '保存失败，请稍后重试'
  } finally {
    busy.value = false
  }
}

async function reorder(list: Topic[]) {
  const token = auth.token.value
  if (!token) return
  busy.value = true
  listError.value = ''
  try {
    // 删除会在 position 上留下空洞，只改被交换/拖动的两项可能排错；按下标重写整列，只发位置真的变了的那几项。
    await Promise.all(
      list.flatMap((t, i) => (t.position === i ? [] : [api.patchTopic(token, selectedNodeId.value, t.id, { position: i })])),
    )
    await reloadTopics()
  } catch {
    listError.value = '排序失败，请稍后重试'
  } finally {
    busy.value = false
  }
}

async function move(topic: Topic, dir: -1 | 1) {
  const list = [...topics.value]
  const idx = list.findIndex((t) => t.id === topic.id)
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
  const list = [...topics.value]
  const [moved] = list.splice(from, 1)
  if (!moved) return
  list.splice(idx, 0, moved)
  await reorder(list)
}

async function remove(topic: Topic) {
  if (!auth.token.value) return
  if (!confirm(`删除话题「${topic.name}」？已发布帖子上的该标签将不再显示。`)) return
  busy.value = true
  listError.value = ''
  try {
    await api.deleteTopic(auth.token.value, selectedNodeId.value, topic.id)
    await reloadTopics()
  } catch {
    listError.value = '删除失败，请稍后重试'
  } finally {
    busy.value = false
  }
}

// ---- create ----
const newName = ref('')
const newColor = ref<string | null>(null)
const createError = ref('')
const creating = ref(false)

async function create() {
  if (!auth.token.value) return
  createError.value = requiredMaxLengthError(newName.value, 16, '话题名称')
  if (createError.value) return
  if (topics.value.length >= TOPIC_LIMIT) {
    createError.value = '话题数量已达上限'
    return
  }
  creating.value = true
  try {
    await api.createTopic(auth.token.value, selectedNodeId.value, { name: newName.value.trim(), color: newColor.value })
    await reloadTopics()
    newName.value = ''
    newColor.value = null
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === 'ALREADY_EXISTS') createError.value = '话题名称已存在'
    else if (err instanceof ApiRequestError && err.code === 'TOPIC_LIMIT') createError.value = '话题数量已达上限'
    else createError.value = '创建失败，请稍后重试'
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="topic-manager">
    <p v-if="listError" class="field__error">{{ listError }}</p>
    <div v-if="topicsLoading" class="admin-modal__loading">加载中…</div>
    <p v-else-if="!topics.length" class="field__hint">暂无话题</p>

    <ul v-else class="topic-list">
      <li
        v-for="(topic, idx) in topics"
        :key="topic.id"
        class="topic-row"
        :class="{ 'topic-row--drag-over': dragOverIndex === idx, 'topic-row--dragging': dragFromIndex === idx }"
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
        <template v-if="editingId === topic.id">
          <div class="topic-swatches topic-row__edit-swatches">
            <button
              type="button"
              class="topic-swatch topic-swatch--none"
              :class="{ 'is-selected': editingColor === null }"
              title="无颜色"
              aria-label="无颜色"
              @click="editingColor = null"
            />
            <button
              v-for="swatch in GROUP_COLOR_SWATCHES"
              :key="swatch.key"
              type="button"
              class="topic-swatch"
              :class="{ 'is-selected': editingColor?.toLowerCase() === swatch.hex.toLowerCase() }"
              :style="{ backgroundColor: swatch.hex }"
              :title="swatch.name"
              :aria-label="swatch.name"
              @click="editingColor = swatch.hex"
            />
          </div>
          <div class="field topic-row__edit">
            <input v-model="editingName" type="text" maxlength="16" @keyup.enter="saveEdit(topic)" @keyup.escape="cancelEdit" />
            <p v-if="editError" class="field__error">{{ editError }}</p>
            <input
              v-model="editingDescription"
              type="text"
              maxlength="64"
              placeholder="话题描述（可选，≤64 字）"
              @keyup.enter="saveEdit(topic)"
              @keyup.escape="cancelEdit"
            />
            <p v-if="descError" class="field__error">{{ descError }}</p>
          </div>
          <div class="topic-row__actions">
            <WinButton Style="AccentButtonStyle" :IsEnabled="!busy" @Click="saveEdit(topic)">保存</WinButton>
            <WinButton Style="SubtleButtonStyle" :IsEnabled="!busy" @Click="cancelEdit">取消</WinButton>
          </div>
        </template>
        <template v-else>
          <span class="topic-row__dot" :style="{ backgroundColor: topic.color ?? 'var(--ctrl-fill-tertiary)' }" />
          <div class="topic-row__info">
            <span class="topic-row__name">{{ topic.name }}</span>
            <span class="topic-row__desc" :class="{ 'topic-row__desc--empty': !topic.description }">
              {{ topic.description || '暂无描述' }}
            </span>
          </div>
          <span class="topic-row__count">{{ topic.post_count }} 篇帖子</span>
          <div class="topic-row__actions">
            <button type="button" class="icon-btn only-mobile" title="上移" :disabled="busy || idx === 0" @click="move(topic, -1)">
              <AppIcon name="chevron-right" :size="16" class="icon-btn__rotate-up" />
            </button>
            <button
              type="button"
              class="icon-btn only-mobile"
              title="下移"
              :disabled="busy || idx === topics.length - 1"
              @click="move(topic, 1)"
            >
              <AppIcon name="chevron-right" :size="16" class="icon-btn__rotate-down" />
            </button>
            <WinButton Style="SubtleButtonStyle" :IsEnabled="!busy" @Click="startEdit(topic)">编辑</WinButton>
            <WinButton Style="SubtleButtonStyle" class="win-btn--danger" :IsEnabled="!busy" @Click="remove(topic)">删除</WinButton>
          </div>
        </template>
      </li>
    </ul>

    <div class="topic-create">
      <div class="topic-swatches">
        <button
          type="button"
          class="topic-swatch topic-swatch--none"
          :class="{ 'is-selected': newColor === null }"
          title="无颜色"
          aria-label="无颜色"
          @click="newColor = null"
        />
        <button
          v-for="swatch in GROUP_COLOR_SWATCHES"
          :key="swatch.key"
          type="button"
          class="topic-swatch"
          :class="{ 'is-selected': newColor?.toLowerCase() === swatch.hex.toLowerCase() }"
          :style="{ backgroundColor: swatch.hex }"
          :title="swatch.name"
          :aria-label="swatch.name"
          @click="newColor = swatch.hex"
        />
      </div>
      <div class="topic-create__row">
        <div class="field topic-create__field">
          <input v-model="newName" type="text" maxlength="16" placeholder="新建话题名称" @keyup.enter="create" />
          <p v-if="createError" class="field__error">{{ createError }}</p>
        </div>
        <WinButton Style="DefaultButtonStyle" :IsEnabled="!creating" @Click="create">
          {{ creating ? '创建中…' : '新建话题' }}
        </WinButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.topic-manager {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.topic-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.topic-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  padding: 0.65rem 0.85rem;
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
}

.topic-row__dot {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.topic-row__info {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.topic-row__name {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topic-row__desc {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topic-row__desc--empty {
  font-style: italic;
}

.topic-row__count {
  flex: 0 0 auto;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.topic-row__edit {
  flex: 1 1 100%;
  min-width: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.topic-row__edit-swatches {
  flex: 1 1 100%;
}

.topic-row__actions {
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

.topic-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.topic-swatch {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}

.topic-swatch--none {
  background: var(--ctrl-fill-tertiary);
  position: relative;
}

.topic-swatch--none::after {
  content: '';
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: linear-gradient(to top right, transparent 46%, var(--text-tertiary) 48%, var(--text-tertiary) 52%, transparent 54%);
}

.topic-swatch.is-selected {
  border-color: rgb(var(--colors-primary));
  box-shadow: 0 0 0 2px var(--card-bg);
}

.topic-create {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 0.4rem;
  border-top: 1px solid var(--card-stroke);
}

.topic-create__row {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
}

.topic-create__field {
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

.topic-row--drag-over {
  border-color: rgb(var(--colors-primary));
  background: var(--card-bg-secondary);
}

.topic-row--dragging {
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
