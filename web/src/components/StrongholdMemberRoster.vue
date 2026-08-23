<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useStrongholdMembers } from '../composables/useStrongholdMembers'
import { useStronghold } from '../composables/useStronghold'
import AvatarBadge from './AvatarBadge.vue'

const { members, loading, loadError } = useStrongholdMembers()
const { isReadOnly } = useStronghold()

const roleLabels = { owner: '据点所有者', mod: '管理员', member: '成员' } as const
const visibleMembers = computed(() => members.value)
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  clock = setInterval(() => { now.value = Date.now() }, 60_000)
})

onBeforeUnmount(() => {
  if (clock) clearInterval(clock)
})

function activityAge(lastActiveAt: string): number {
  return now.value - Date.parse(lastActiveAt)
}

function activityLabel(lastActiveAt: string | null): string {
  if (!lastActiveAt) return '暂无活动记录'
  const age = activityAge(lastActiveAt)
  if (age < 5 * 60 * 1000) return '活跃'
  if (age < 7 * 24 * 60 * 60 * 1000) return '最近活跃'
  return '暂不活跃'
}

function activityClass(lastActiveAt: string | null): string {
  if (!lastActiveAt) return 'member-roster__status-dot--unknown'
  const age = activityAge(lastActiveAt)
  if (age < 5 * 60 * 1000) return 'member-roster__status-dot--active'
  return age < 7 * 24 * 60 * 60 * 1000 ? 'member-roster__status-dot--recent' : 'member-roster__status-dot--idle'
}
</script>

<template>
  <section v-if="!isReadOnly" class="member-roster" aria-labelledby="member-roster-title">
    <div class="member-roster__heading">
      <h2 id="member-roster-title">据点成员</h2>
      <span class="member-roster__count">{{ visibleMembers.length }}</span>
    </div>
    <p class="member-roster__presence-note">基于最近活动记录，不代表实时在线</p>
    <p v-if="loading" class="member-roster__empty">正在加载成员…</p>
    <p v-else-if="loadError" class="member-roster__empty member-roster__empty--error">{{ loadError }}</p>
    <p v-else-if="visibleMembers.length === 0" class="member-roster__empty">暂无成员</p>
    <ul v-else class="member-roster__list">
      <li v-for="member in visibleMembers" :key="member.actor" class="member-roster__item">
        <AvatarBadge :seed="member.username" :size="34" :avatar-url="member.avatar ?? undefined" />
        <span class="member-roster__identity">
          <strong class="member-roster__name">{{ member.display_name }}</strong>
          <span class="member-roster__username">@{{ member.username }}</span>
        </span>
        <span class="member-roster__status" :title="`${activityLabel(member.last_active_at)}；${roleLabels[member.role]}`">
          <span class="member-roster__status-dot" :class="activityClass(member.last_active_at)" aria-hidden="true" />
          <span>{{ activityLabel(member.last_active_at) }}</span>
        </span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.member-roster { min-height: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: .55rem; overflow: hidden; }
.member-roster__heading { display: flex; align-items: center; gap: .45rem; flex: 0 0 auto; }
.member-roster__heading h2 { margin: 0; color: var(--text-primary); font-size: .88rem; font-weight: 600; }
.member-roster__count { min-width: 1.3rem; padding: .08rem .35rem; border-radius: 999px; color: var(--text-secondary); background: var(--card-bg); font-size: .72rem; text-align: center; }
.member-roster__presence-note, .member-roster__empty { margin: 0; flex: 0 0 auto; color: var(--text-secondary); font-size: .72rem; }
.member-roster__empty--error { color: var(--critical-text); }
.member-roster__list { min-height: 0; flex: 1 1 auto; margin: 0; padding: 0 .15rem 0 0; overflow-y: auto; list-style: none; }
.member-roster__item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: .55rem; padding: .48rem 0; border-bottom: 1px solid var(--stroke-divider); }
.member-roster__identity { min-width: 0; display: flex; flex-direction: column; gap: .12rem; }
.member-roster__name, .member-roster__username { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.member-roster__name { color: var(--text-primary); font-size: .8rem; font-weight: 600; }
.member-roster__username { color: var(--text-secondary); font-size: .68rem; }
.member-roster__status { display: inline-flex; align-items: center; gap: .25rem; max-width: 5.5rem; color: var(--text-secondary); font-size: .63rem; text-align: right; }
.member-roster__status-dot { width: .42rem; height: .42rem; flex: 0 0 auto; border: 1px solid var(--text-secondary); border-radius: 50%; opacity: .7; }
.member-roster__status-dot--active { border-color: var(--success-text, #3ca370); background: var(--success-text, #3ca370); }
.member-roster__status-dot--recent { border-color: var(--warning-text, #bd8b32); background: var(--warning-text, #bd8b32); }
.member-roster__status-dot--idle { border-color: var(--text-secondary); background: transparent; }
.member-roster__status-dot--unknown { border-color: var(--text-secondary); }
</style>
