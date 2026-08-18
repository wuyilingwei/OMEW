<script setup lang="ts">
import { computed } from 'vue'
import { avatarBackground, avatarInitial } from '../utils/avatar'

const props = withDefaults(defineProps<{ seed: string; size?: number }>(), {
  size: 36,
})

const background = computed(() => avatarBackground(props.seed))
const initial = computed(() => avatarInitial(props.seed))
</script>

<template>
  <span
    class="avatar-badge"
    :style="{ width: `${size}px`, height: `${size}px`, background, fontSize: `${size * 0.42}px` }"
    :title="seed"
  >{{ initial }}</span>
</template>

<style scoped>
.avatar-badge {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #fff;
  font-weight: 600;
  line-height: 1;
  user-select: none;
}
</style>
