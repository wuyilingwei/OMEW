<script setup lang="ts">
import { watch } from 'vue'
import { useStronghold } from '../composables/useStronghold'
import { WinButton } from '../vendor/winui'
import { HOME_WORLD } from '../assets/mew'

const props = defineProps<{ guestBrowsingAllowed: boolean }>()

const emit = defineEmits<{
  authenticate: []
  browse: [strongholdId?: string]
}>()

const { publicDirectory: entries, loading: directoryLoading, loadError: directoryError, loadPublicDirectory } = useStronghold()

watch(
  () => props.guestBrowsingAllowed,
  (allowed) => {
    if (allowed) void loadPublicDirectory()
  },
  { immediate: true },
)
</script>

<template>
  <main class="landing-page">
    <img class="landing-page__world" :src="HOME_WORLD" alt="" aria-hidden="true" />
    <div class="landing-page__shade" aria-hidden="true" />

    <div class="landing-page__hero-screen">
      <header class="landing-page__header">
        <a class="landing-page__brand" href="/" aria-label="OMEW 首页">
          <img src="/favicon.svg" alt="" aria-hidden="true" />
          <span>OMEW</span>
        </a>
      </header>

      <section class="landing-page__hero" aria-labelledby="landing-title">
        <p class="landing-page__eyebrow">OPEN MEW</p>
        <h1 id="landing-title">为你的小世界，留一扇开放的门。</h1>
        <p class="landing-page__subtitle">创建据点、分享正在发生的事，并在你信任的社区里自在交流。</p>
        <div class="landing-page__actions">
          <WinButton Style="AccentButtonStyle" class="landing-page__primary" @Click="emit('authenticate')">
            登录或注册
          </WinButton>
          <WinButton
            v-if="guestBrowsingAllowed"
            Style="DefaultButtonStyle"
            class="landing-page__secondary"
            @Click="emit('browse')"
          >
            浏览公开据点
          </WinButton>
        </div>
      </section>

      <section class="landing-page__features" aria-label="OMEW 的能力">
        <article>
          <h2>你的据点</h2>
          <p>用独立空间沉淀成员、主题与共同记忆。</p>
        </article>
        <article>
          <h2>即时相遇</h2>
          <p>聊天与动态并行，让回应自然发生。</p>
        </article>
        <article>
          <h2>自在连接</h2>
          <p>按自己的节奏加入值得停留的社区。</p>
        </article>
      </section>
    </div>

    <section class="landing-page__directory" aria-labelledby="directory-title">
      <div class="landing-page__directory-heading">
        <div>
          <p class="landing-page__directory-eyebrow">DISCOVER</p>
          <h2 id="directory-title">正在发生的据点</h2>
          <p>向下看看每个正在生长的小世界。</p>
        </div>
        <WinButton v-if="guestBrowsingAllowed" Style="DefaultButtonStyle" @Click="emit('browse')">进入公开据点大厅</WinButton>
      </div>

      <div v-if="directoryLoading" class="landing-page__directory-status" role="status" aria-live="polite">
        <span class="landing-page__directory-spinner" aria-hidden="true" />
        正在加载公开据点…
      </div>
      <div v-else-if="directoryError" class="landing-page__directory-status landing-page__directory-status--error" role="status">
        <p>{{ directoryError || '无法加载据点目录' }}</p>
        <WinButton Style="DefaultButtonStyle" @Click="loadPublicDirectory(true)">重试</WinButton>
      </div>
      <p v-else-if="!entries.length" class="landing-page__directory-status">还没有公开据点，稍后再来看看。</p>
      <ul v-else class="landing-page__directory-list">
        <li v-for="entry in entries" :key="entry.id">
          <button class="landing-directory-card" type="button" :aria-label="`进入 ${entry.name}`" @click="emit('browse', entry.id)">
            <img v-if="entry.cover" class="landing-directory-card__cover" :src="entry.cover" alt="" />
            <div class="landing-directory-card__body">
              <div class="landing-directory-card__identity">
                <div class="landing-directory-card__avatar" :aria-label="`${entry.name} 据点头像`">
                  <img v-if="entry.avatar" :src="entry.avatar" :alt="entry.name" />
                  <span v-else aria-hidden="true">{{ entry.name.slice(0, 1) }}</span>
                </div>
                <div>
                  <h3>{{ entry.name }}</h3>
                  <p>{{ entry.member_count }} 位成员</p>
                </div>
              </div>
              <p class="landing-directory-card__preview">{{ entry.description || '这里正在等待一段新的共同记忆。' }}</p>
            </div>
          </button>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.landing-page {
  isolation: isolate;
  position: relative;
  min-height: 100%;
  color: #fff;
  background: #14233f;
}

.landing-page__hero-screen {
  position: relative;
  isolation: isolate;
  min-height: 100svh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  padding: clamp(1.25rem, 3vw, 3rem) clamp(1.25rem, 6vw, 7rem) clamp(1.5rem, 4vw, 3.5rem);
  overflow: hidden;
}

.landing-page__world,
.landing-page__shade {
  position: absolute;
  inset: 0;
  z-index: -2;
  width: 100%;
  height: 100%;
}

.landing-page__world {
  object-fit: cover;
  object-position: center;
  transform: scale(1.02);
  animation: landing-world-arrive 900ms var(--fast-out-slow-in, ease-out) both;
}

.landing-page__shade {
  z-index: -1;
  background:
    linear-gradient(90deg, rgb(7 15 35 / 0.8) 0%, rgb(9 19 42 / 0.57) 46%, rgb(9 17 34 / 0.28) 100%),
    linear-gradient(0deg, rgb(4 10 23 / 0.62), transparent 45%);
}

.landing-page__header {
  display: flex;
  align-items: center;
}

.landing-page__brand {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  color: inherit;
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-decoration: none;
}

.landing-page__brand:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 5px;
  border-radius: 4px;
}

.landing-page__brand img {
  width: 2.15rem;
  height: 2.15rem;
  filter: drop-shadow(0 2px 8px rgb(0 0 0 / 0.2));
}

.landing-page__hero {
  align-self: center;
  max-width: 43rem;
  padding: clamp(3rem, 8vh, 6rem) 0;
  animation: landing-content-arrive 700ms var(--fast-out-slow-in, ease-out) 100ms both;
}

.landing-page__eyebrow {
  margin: 0 0 0.9rem;
  color: rgb(235 243 255 / 0.82);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.18em;
}

h1 {
  max-width: 10em;
  margin: 0;
  font-size: clamp(2.45rem, 5.3vw, 5.25rem);
  line-height: 1.12;
  letter-spacing: -0.045em;
  text-wrap: balance;
  text-shadow: 0 3px 20px rgb(0 0 0 / 0.2);
}

.landing-page__subtitle {
  max-width: 32rem;
  margin: 1.4rem 0 0;
  color: rgb(245 249 255 / 0.9);
  font-size: clamp(1rem, 1.4vw, 1.13rem);
  line-height: 1.75;
  text-wrap: pretty;
}

.landing-page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 2rem;
}

.landing-page__primary,
.landing-page__secondary {
  min-width: 9.5rem;
  min-height: 2.85rem;
  font-weight: 600;
}

.landing-page__secondary {
  --ctrl-fill-default: rgb(255 255 255 / 0.13);
  --ctrl-fill-secondary: rgb(255 255 255 / 0.21);
  --ctrl-fill-tertiary: rgb(255 255 255 / 0.28);
  --ctrl-border: rgb(255 255 255 / 0.48);
  color: #fff;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.landing-page__features {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: clamp(1rem, 3vw, 3rem);
  max-width: 61rem;
}

.landing-page__features article {
  padding-top: 1rem;
  border-top: 1px solid rgb(255 255 255 / 0.36);
}

.landing-page__features h2,
.landing-page__features p {
  margin: 0;
}

.landing-page__directory {
  position: relative;
  padding: clamp(3rem, 7vw, 6rem) clamp(1.25rem, 6vw, 7rem) clamp(4rem, 8vw, 7rem);
  color: var(--text-primary);
  background: var(--app-bg);
}

.landing-page__directory::before {
  position: absolute;
  inset: 0 0 auto;
  height: 8rem;
  content: '';
  background: linear-gradient(180deg, rgb(7 15 35 / 0.56), transparent);
  pointer-events: none;
}

.landing-page__directory-heading,
.landing-page__directory-list,
.landing-page__directory-status {
  position: relative;
  max-width: 70rem;
  margin-inline: auto;
}

.landing-page__directory-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.landing-page__directory-eyebrow {
  margin: 0 0 0.5rem;
  color: rgb(var(--colors-primary));
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.landing-page__directory h2,
.landing-page__directory-heading p {
  margin: 0;
}

.landing-page__directory h2 {
  font-size: clamp(1.7rem, 3vw, 2.5rem);
  letter-spacing: -0.035em;
}

.landing-page__directory-heading > div > p:last-child {
  margin-top: 0.65rem;
  color: var(--text-secondary);
}

.landing-page__directory-status {
  min-height: 11rem;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 0.75rem;
  color: var(--text-secondary);
  text-align: center;
}

.landing-page__directory-status p { margin: 0; }
.landing-page__directory-status--error { color: var(--critical-text); }

.landing-page__directory-spinner {
  width: 1.5rem;
  aspect-ratio: 1;
  border: 2px solid var(--ctrl-border);
  border-top-color: rgb(var(--colors-primary));
  border-radius: 50%;
  animation: landing-directory-spin 0.8s linear infinite;
}

.landing-page__directory-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin-block: 0;
  padding: 0;
  list-style: none;
}

.landing-directory-card {
  width: 100%;
  height: 100%;
  padding: 0;
  color: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-md);
  background: var(--card-bg);
  box-shadow: var(--shadow-card);
  transition: transform var(--fast-duration) var(--fast-out-slow-in), border-color var(--fast-duration) var(--fast-out-slow-in);
}

.landing-directory-card:hover {
  transform: translateY(-2px);
  border-color: var(--ctrl-border-accent);
}

.landing-directory-card:focus-visible {
  outline: 2px solid rgb(var(--colors-primary));
  outline-offset: 3px;
}

.landing-directory-card__cover {
  width: 100%;
  aspect-ratio: 16 / 7;
  object-fit: cover;
}

.landing-directory-card__body { padding: 1rem; }

.landing-directory-card__identity {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.landing-directory-card__avatar {
  flex: 0 0 3rem;
  flex-shrink: 0;
  width: 3rem;
  aspect-ratio: 1;
  overflow: hidden;
  display: grid;
  place-items: center;
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-sm);
  background: rgb(var(--colors-primary));
  color: var(--on-accent);
  font-weight: 700;
}

.landing-directory-card__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.landing-directory-card__identity h3,
.landing-directory-card__identity p,
.landing-directory-card__preview { margin: 0; }
.landing-directory-card__identity h3 { font-size: 1rem; }
.landing-directory-card__identity p { margin-top: 0.2rem; color: var(--text-tertiary); font-size: 0.78rem; }

.landing-directory-card__preview {
  margin-top: 0.9rem;
  color: var(--text-secondary);
  font-size: 0.88rem;
  line-height: 1.55;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

@keyframes landing-directory-spin { to { transform: rotate(360deg); } }

.landing-page__features h2 {
  font-size: 0.95rem;
  font-weight: 650;
}

.landing-page__features p {
  margin-top: 0.45rem;
  color: rgb(238 244 255 / 0.82);
  font-size: 0.86rem;
  line-height: 1.6;
}

@keyframes landing-world-arrive {
  from { opacity: 0; transform: scale(1.06); }
  to { opacity: 1; transform: scale(1.02); }
}

@keyframes landing-content-arrive {
  from { opacity: 0; transform: translateY(1rem); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 700px) {
  .landing-page__world {
    object-position: 59% center;
  }

  .landing-page__hero {
    align-self: end;
    padding: 3.5rem 0 2.5rem;
  }

  .landing-page__features {
    grid-template-columns: 1fr;
    gap: 0.7rem;
  }

  .landing-page__features article {
    padding-top: 0.7rem;
  }

  .landing-page__directory-heading {
    align-items: start;
    flex-direction: column;
  }

  .landing-page__directory-list { grid-template-columns: 1fr; }
}

@media (max-width: 390px) {
  .landing-page__actions,
  .landing-page__actions :deep(button) {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .landing-page__world,
  .landing-page__hero,
  .landing-page__directory-spinner {
    animation: none;
  }

  .landing-directory-card { transition: none; }
}
</style>
