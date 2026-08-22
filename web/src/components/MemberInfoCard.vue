<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, ApiRequestError } from '../api'
import type { PublicUser, StrongholdMember } from '../api/types'
import { useAuth } from '../composables/useAuth'
import { WinButton } from '../vendor/winui'
import AvatarBadge from './AvatarBadge.vue'

// task 048: group membership is server-level and read-only here - assignment
// moved to ServerAdminModal's member rows, so this card just displays the
// badges already carried on `member.groups` (populated from the batch
// GET /api/server-groups/members lookup).
const props = defineProps<{ member: StrongholdMember }>()
defineEmits<{ close: [] }>()

const ROLE_LABEL: Record<string, string> = { owner: '领主', mod: '管理员', member: '成员' }

const auth = useAuth()
const profile = ref<PublicUser | null>(null)

onMounted(async () => {
  if (!auth.token.value) return
  try {
    profile.value = await api.getUser(auth.token.value, props.member.actor)
  } catch (err) {
    // profile lookup is a nice-to-have on top of the membership row we
    // already have — fall back silently to that row's own fields
    if (!(err instanceof ApiRequestError)) throw err
  }
})
</script>

<template>
  <Teleport to="body">
    <div class="member-info-overlay" @click.self="$emit('close')">
      <div class="member-info-card" role="dialog" aria-modal="true" :aria-label="member.display_name">
        <WinButton Style="SubtleButtonStyle" class="member-info-card__close" @click="$emit('close')">关闭</WinButton>
        <AvatarBadge :seed="member.username" :size="64" />
        <h2 class="member-info-card__name">{{ profile?.display_name ?? member.display_name }}</h2>
        <p class="member-info-card__actor">{{ member.actor }}</p>
        <p v-if="member.is_guest" class="member-info-card__guest">宾客 · 来自 {{ member.home_domain }}</p>
        <dl class="member-info-card__meta">
          <dt>角色</dt>
          <dd>{{ ROLE_LABEL[member.role] }}</dd>
          <dt>加入时间</dt>
          <dd>{{ new Date(member.joined_at).toLocaleDateString() }}</dd>
        </dl>

        <div v-if="member.groups.length" class="member-info-card__groups">
          <h3 class="member-info-card__groups-title">用户组</h3>
          <ul class="member-info-card__group-list">
            <li v-for="group in member.groups" :key="group.id" class="member-info-card__group-row">
              <span class="member-info-card__group-badge">
                <span class="member-info-card__group-dot" :style="{ backgroundColor: group.color ?? 'var(--ctrl-fill-tertiary)' }" />
                {{ group.name }}
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.member-info-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: var(--overlay-scrim-soft);
}

.member-info-card {
  position: relative;
  width: 100%;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 2rem 1.5rem 1.5rem;
  border-radius: var(--radius-md);
  background: var(--flyout-bg, var(--layer-default));
  border: 1px solid var(--card-stroke);
  box-shadow: var(--shadow-dialog);
  backdrop-filter: blur(32px) saturate(160%);
  -webkit-backdrop-filter: blur(32px) saturate(160%);
}

.member-info-card__close {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
}

.member-info-card__name {
  margin: 0.5rem 0 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
}

.member-info-card__actor {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-tertiary);
}

.member-info-card__guest {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.member-info-card__meta {
  width: 100%;
  margin: 0.75rem 0 0;
  padding-top: 0.75rem;
  border-top: 1px solid var(--stroke-divider);
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.3rem 0.75rem;
  font-size: 0.82rem;
}

.member-info-card__meta dt {
  color: var(--text-tertiary);
}

.member-info-card__meta dd {
  margin: 0;
  color: var(--text-primary);
  text-align: right;
}

.member-info-card__groups {
  width: 100%;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--stroke-divider);
}

.member-info-card__groups-title {
  margin: 0 0 0.4rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.member-info-card__group-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.member-info-card__group-badge {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.82rem;
  color: var(--text-primary);
}

.member-info-card__group-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: 0 0 auto;
}
</style>
