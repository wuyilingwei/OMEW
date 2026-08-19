<script setup lang="ts">
import { computed } from 'vue'
import { defaultAvatarUrl } from '../utils/avatar'

// avatarUrl is reserved for a future real-avatar-upload feature - no call site
// passes it today, so every avatar currently falls back to the default image.
const props = withDefaults(defineProps<{ seed: string; size?: number; avatarUrl?: string }>(), {
  size: 36,
})

const src = computed(() => props.avatarUrl || defaultAvatarUrl(props.seed))
</script>

<template>
  <img
    class="avatar-badge"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :src="src"
    :alt="seed"
    :title="seed"
  />
</template>

<style scoped>
.avatar-badge {
  flex: 0 0 auto;
  border-radius: 50%;
  object-fit: cover;
  user-select: none;
}
</style>
