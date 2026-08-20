<script setup lang="ts">
import AuthForm from './AuthForm.vue'
</script>

<template>
  <div class="auth-gate">
    <div class="auth-card">
      <AuthForm />
    </div>
  </div>
</template>

<style scoped>
.auth-gate {
  position: relative;
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
}

.auth-card {
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
</style>
