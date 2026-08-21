<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api, ApiRequestError } from '../api'
import type { StrongholdApplication, StrongholdCreationPolicy } from '../api/types'
import { useAuth } from '../composables/useAuth'
import { useStronghold } from '../composables/useStronghold'
import { requiredMaxLengthError } from '../utils/validate'
import { WinButton, WinComboBox, WinInfoBar } from '../vendor/winui'

const emit = defineEmits<{ created: [] }>()

const auth = useAuth()
const { loadStrongholds, selectNode } = useStronghold()

const policy = ref<StrongholdCreationPolicy>('open')
const policyLoading = ref(true)
// set once a "restricted" create attempt actually comes back CREATION_RESTRICTED -
// the client can't know the creators allowlist upfront (server keeps it admin-only).
const restrictedDenied = ref(false)
const myApplications = ref<StrongholdApplication[]>([])

const form = reactive({ name: '', description: '', visibility: 'public' as 'public' | 'private' })
const busy = ref(false)
const error = ref('')
const submittedApplication = ref(false)

const STATE_LABEL: Record<string, string> = { pending: '审核中', approved: '已通过', rejected: '已拒绝' }
const VISIBILITY_OPTIONS = [
  { Text: '公开', Value: 'public' },
  { Text: '私密', Value: 'private' },
]

async function loadPolicy() {
  policyLoading.value = true
  try {
    const config = await api.getInstanceConfig()
    policy.value = config.stronghold_creation
  } catch {
    policy.value = 'open'
  } finally {
    policyLoading.value = false
  }
}

async function loadMyApplications() {
  if (!auth.token.value) return
  try {
    myApplications.value = await api.getMyStrongholdApplications(auth.token.value)
  } catch {
    myApplications.value = []
  }
}

onMounted(async () => {
  await loadPolicy()
  if (policy.value === 'application') await loadMyApplications()
})

async function submit() {
  if (!auth.token.value || busy.value) return
  error.value = requiredMaxLengthError(form.name, 32, '名称')
  if (error.value) return
  busy.value = true
  try {
    const result = await api.createStronghold(auth.token.value, {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      visibility: form.visibility,
    })
    if ('application_id' in result) {
      submittedApplication.value = true
      await loadMyApplications()
      return
    }
    await loadStrongholds(true)
    selectNode(result.id)
    emit('created')
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === 'CREATION_RESTRICTED') {
      restrictedDenied.value = true
      return
    }
    error.value = '创建失败，请稍后重试'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="create-stronghold">
    <div v-if="policyLoading" class="create-stronghold__notice">正在加载节点配置…</div>

    <WinInfoBar v-else-if="restrictedDenied" :IsOpen="true" :IsClosable="false" :IsIconVisible="false" Severity="Informational">
      本实例仅特定成员可创建据点。
    </WinInfoBar>

    <template v-else-if="policy === 'application' && submittedApplication">
      <WinInfoBar :IsOpen="true" :IsClosable="false" :IsIconVisible="false" Severity="Informational">
        申请已提交，等待管理员审核。
      </WinInfoBar>
    </template>

    <template v-else>
      <ul v-if="policy === 'application' && myApplications.length" class="create-stronghold__applications">
        <li v-for="app in myApplications" :key="app.id" class="create-stronghold__application">
          <span>{{ app.name }}</span>
          <span class="create-stronghold__application-state" :class="`create-stronghold__application-state--${app.state}`">
            {{ STATE_LABEL[app.state] }}
          </span>
        </li>
      </ul>

      <form @submit.prevent="submit">
        <div class="field">
          <label class="field__label" for="cs-name">名称</label>
          <input id="cs-name" v-model.trim="form.name" type="text" required maxlength="32" placeholder="给据点起个名字（≤32 字）" />
        </div>
        <div class="field">
          <label class="field__label" for="cs-desc">描述（可选）</label>
          <textarea id="cs-desc" v-model="form.description" rows="3" placeholder="这个据点是做什么的？"></textarea>
        </div>
        <div class="field">
          <span class="field__label">可见性</span>
          <WinComboBox
            :ItemsSource="VISIBILITY_OPTIONS"
            SelectedValuePath="Value"
            v-model:SelectedValue="form.visibility"
          />
        </div>
        <p v-if="error" class="field__error">{{ error }}</p>
        <WinButton Style="AccentButtonStyle" type="submit" :IsEnabled="!busy" class="create-stronghold__submit">
          {{ busy ? (policy === 'application' ? '提交中…' : '创建中…') : policy === 'application' ? '提交申请' : '创建据点' }}
        </WinButton>
      </form>
    </template>
  </div>
</template>

<style scoped>
.create-stronghold {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.create-stronghold form {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.create-stronghold__notice {
  font-size: 0.85rem;
  color: var(--text-tertiary);
}

.create-stronghold__submit {
  width: 100%;
  justify-content: center;
  margin-top: 0.15rem;
}

.create-stronghold__applications {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.create-stronghold__application {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.4rem 0.6rem;
  border-radius: var(--radius-xs);
  background: var(--ctrl-fill-secondary);
  font-size: 0.82rem;
}

.create-stronghold__application-state {
  color: var(--text-tertiary);
}

.create-stronghold__application-state--approved {
  color: var(--SystemFillColorSuccessBrush);
}

.create-stronghold__application-state--rejected {
  color: var(--SystemFillColorCriticalBrush);
}
</style>
