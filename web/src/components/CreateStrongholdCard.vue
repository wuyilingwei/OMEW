<script setup lang="ts">
import { reactive, ref } from 'vue'
import { api, ApiRequestError } from '../api'
import { useAuth } from '../composables/useAuth'
import { useStronghold } from '../composables/useStronghold'
import { WinButton } from '../vendor/winui'

const emit = defineEmits<{ created: [] }>()

const auth = useAuth()
const { loadStrongholds, selectNode } = useStronghold()

const form = reactive({ name: '', description: '', visibility: 'public' as 'public' | 'private' })
const busy = ref(false)
const error = ref('')

async function submit() {
  if (!auth.token.value || !form.name.trim() || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const config = await api.createStronghold(auth.token.value, {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      visibility: form.visibility,
    })
    await loadStrongholds(true)
    selectNode(config.id)
    emit('created')
  } catch (err) {
    error.value = err instanceof ApiRequestError ? `创建失败：${err.code}` : '创建失败，请稍后重试'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="create-stronghold" @submit.prevent="submit">
    <div class="field">
      <label class="field__label" for="cs-name">名称</label>
      <input id="cs-name" v-model.trim="form.name" type="text" required maxlength="40" placeholder="给据点起个名字" />
    </div>
    <div class="field">
      <label class="field__label" for="cs-desc">描述（可选）</label>
      <textarea id="cs-desc" v-model="form.description" rows="3" placeholder="这个据点是做什么的？"></textarea>
    </div>
    <div class="field">
      <label class="field__label" for="cs-visibility">可见性</label>
      <select id="cs-visibility" v-model="form.visibility">
        <option value="public">公开</option>
        <option value="private">私密</option>
      </select>
    </div>
    <p v-if="error" class="field__error">{{ error }}</p>
    <WinButton Style="AccentButtonStyle" type="submit" :IsEnabled="!busy" class="create-stronghold__submit">
      {{ busy ? '创建中…' : '创建据点' }}
    </WinButton>
  </form>
</template>

<style scoped>
.create-stronghold {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.create-stronghold__submit {
  width: 100%;
  justify-content: center;
  margin-top: 0.15rem;
}
</style>
