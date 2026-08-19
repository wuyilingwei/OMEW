import { ref } from 'vue'

const openPostSeq = ref<number | null>(null)

function open(postSeq: number) {
  openPostSeq.value = postSeq
}

function close() {
  openPostSeq.value = null
}

export function usePostModal() {
  return { openPostSeq, open, close }
}
