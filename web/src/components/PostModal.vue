<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useAuthModal } from '../composables/useAuthModal'
import { usePostModal } from '../composables/usePostModal'
import { useSectionRoom } from '../composables/useSectionRoom'
import { useStrongholdMembers } from '../composables/useStrongholdMembers'
import { useTopics } from '../composables/useTopics'
import { actorLocalpart } from '../utils/actor'
import { WinButton } from '../vendor/winui'
import AvatarBadge from './AvatarBadge.vue'
import MediaGrid from './MediaGrid.vue'
import TopicChips from './TopicChips.vue'

const auth = useAuth()
const { openAuthModal } = useAuthModal()
const { openPostSeq, close } = usePostModal()
const { thread, threadLoading, threadRepliesLoading, threadHasMore, openThread, closeThread, loadMoreReplies, createReply } =
  useSectionRoom()
const { members } = useStrongholdMembers()
const { topics } = useTopics()

const replyDraft = ref('')
const replyError = ref('')

function displayName(actor: string): string {
  return members.value.find((m) => m.actor === actor)?.display_name ?? actorLocalpart(actor)
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

watch(openPostSeq, (seq) => {
  if (seq != null) void openThread(seq)
  else closeThread()
})

function submitReply() {
  replyError.value = ''
  if (!replyDraft.value.trim()) return
  const ok = createReply(replyDraft.value)
  if (!ok) {
    replyError.value = '发送失败，连接尚未就绪，请稍后再试'
    return
  }
  replyDraft.value = ''
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && openPostSeq.value != null) close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="post-modal">
      <div v-if="openPostSeq != null" class="post-modal-overlay" @click.self="close">
        <div class="post-modal" role="dialog" aria-modal="true">
          <WinButton Style="SubtleButtonStyle" class="post-modal__close" @Click="close">关闭</WinButton>

          <div v-if="threadLoading && !thread" class="post-modal__loading">加载中…</div>

          <div v-else-if="thread" class="post-modal__scroll">
            <img v-if="thread.post.cover" class="post-modal__cover" :src="thread.post.cover" :alt="thread.post.title" />
            <div class="post-modal__body">
              <h1 class="post-modal__title">{{ thread.post.title }}</h1>
              <div class="post-modal__author-row">
                <AvatarBadge :seed="displayName(thread.post.actor)" :size="36" />
                <div class="post-modal__author-meta">
                  <span class="post-modal__author-name">{{ displayName(thread.post.actor) }}</span>
                  <span class="post-modal__time">{{ formatTime(thread.post.created_at) }}</span>
                </div>
              </div>
              <p v-for="(paragraph, index) in thread.post.text.split('\n\n')" :key="index" class="post-modal__paragraph">
                {{ paragraph }}
              </p>
              <MediaGrid v-if="thread.post.media?.length" :media="thread.post.media" />
              <TopicChips v-if="thread.post.topics?.length" :topics="topics" :ids="thread.post.topics" />

              <div class="post-modal__comments">
                <h2 class="post-modal__comments-title">评论（{{ thread.post.reply_count }}）</h2>
                <p v-if="!thread.replies.length" class="post-modal__comments-empty">暂无评论，来说两句吧。</p>
                <ul v-else class="post-modal__reply-list">
                  <li v-for="reply in thread.replies" :key="reply.seq" class="post-modal__reply">
                    <AvatarBadge :seed="displayName(reply.actor)" :size="28" />
                    <div class="post-modal__reply-body">
                      <div class="post-modal__reply-meta">
                        <span class="post-modal__reply-author">{{ displayName(reply.actor) }}</span>
                        <span class="post-modal__time">{{ formatTime(reply.ts) }}</span>
                      </div>
                      <p class="post-modal__reply-text">{{ reply.body.text }}</p>
                      <MediaGrid v-if="reply.body.media?.length" :media="reply.body.media" />
                    </div>
                  </li>
                </ul>
                <div v-if="threadHasMore" class="post-modal__more">
                  <WinButton Style="SubtleButtonStyle" :IsEnabled="!threadRepliesLoading" @Click="loadMoreReplies">
                    {{ threadRepliesLoading ? '加载中…' : '加载更多评论' }}
                  </WinButton>
                </div>

                <div v-if="auth.isAuthenticated.value" class="post-modal__reply-form">
                  <textarea v-model="replyDraft" rows="2" placeholder="写评论…"></textarea>
                  <p v-if="replyError" class="field__error">{{ replyError }}</p>
                  <WinButton Style="AccentButtonStyle" class="post-modal__reply-submit" @Click="submitReply">回复</WinButton>
                </div>
                <div v-else class="post-modal__reply-form post-modal__reply-form--guest">
                  <p class="field__hint">登录后参与评论</p>
                  <WinButton Style="AccentButtonStyle" @Click="openAuthModal">登录 / 注册</WinButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.post-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: rgba(0, 0, 0, 0.5);
}

.post-modal {
  position: relative;
  width: 56%;
  min-width: 320px;
  max-width: 720px;
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

.post-modal-enter-active,
.post-modal-leave-active {
  transition: opacity var(--normal-duration) var(--fast-out-slow-in);
}

.post-modal-enter-active .post-modal,
.post-modal-leave-active .post-modal {
  transition:
    opacity var(--normal-duration) var(--fast-out-slow-in),
    transform var(--normal-duration) var(--fast-out-slow-in);
}

.post-modal-enter-from,
.post-modal-leave-to {
  opacity: 0;
}

.post-modal-enter-from .post-modal,
.post-modal-leave-to .post-modal {
  opacity: 0;
  transform: scale(0.94) translateY(12px);
}

@media (prefers-reduced-motion: reduce) {
  .post-modal-enter-active,
  .post-modal-leave-active,
  .post-modal-enter-active .post-modal,
  .post-modal-leave-active .post-modal {
    transition: none !important;
  }
}

.post-modal__close {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
  z-index: 1;
}

.post-modal__loading {
  padding: 3rem 1.5rem;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 0.85rem;
}

.post-modal__scroll {
  overflow-y: auto;
}

.post-modal__cover {
  width: 100%;
  height: 220px;
  object-fit: cover;
}

.post-modal__body {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1.5rem 1.75rem 2rem;
}

.post-modal__title {
  margin: 0;
  padding-right: 3rem;
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--text-primary);
}

.post-modal__author-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.post-modal__author-meta {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.post-modal__author-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.post-modal__time {
  font-size: 0.72rem;
  color: var(--text-tertiary);
}

.post-modal__paragraph {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--text-secondary);
  white-space: pre-wrap;
}

.post-modal__comments {
  margin-top: 0.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--stroke-divider);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.post-modal__comments-title {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.post-modal__comments-empty {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-tertiary);
}

.post-modal__reply-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.post-modal__reply {
  display: flex;
  gap: 0.5rem;
}

.post-modal__reply-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.post-modal__reply-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.post-modal__reply-author {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-primary);
}

.post-modal__reply-text {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--text-secondary);
  white-space: pre-wrap;
}

.post-modal__more {
  display: flex;
  justify-content: center;
}

.post-modal__reply-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.3rem;
}

.post-modal__reply-form textarea {
  font: inherit;
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius-xs);
  border: 1px solid var(--ctrl-border);
  background: var(--ctrl-fill-secondary);
  color: var(--text-primary);
  resize: vertical;
}

.post-modal__reply-submit {
  align-self: flex-end;
}

.post-modal__reply-form--guest {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.7rem 0.9rem;
  border-radius: var(--radius-sm);
  background: var(--ctrl-fill-secondary);
}

.post-modal__reply-form--guest .field__hint {
  margin: 0;
}

@media (max-width: 768px) {
  .post-modal-overlay {
    padding: 0;
  }

  .post-modal {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    border-radius: 0;
    background: var(--dialog-background);
  }
}
</style>
