<script setup lang="ts">
import CreateStrongholdCard from './CreateStrongholdCard.vue'
</script>

<template>
  <div class="onboarding">
    <div class="onboarding-card">
      <h1 class="onboarding-card__title">还没有据点</h1>
      <p class="onboarding-card__hint">创建一个据点，开始聊天和发帖——你会成为它的第一位领主。</p>
      <CreateStrongholdCard />
    </div>
  </div>
</template>

<style scoped>
.onboarding {
  position: relative;
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
}

.onboarding-card {
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  padding: 2rem;
  border-radius: var(--radius-md);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18);
}

.onboarding-card__title {
  margin: 0;
  text-align: center;
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--text-primary);
}

.onboarding-card__hint {
  margin: -0.4rem 0 0;
  text-align: center;
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--text-secondary);
}
</style>
