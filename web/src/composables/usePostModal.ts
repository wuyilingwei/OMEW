import { ref } from 'vue'
import type { Post } from '../types/models'

const openPost = ref<Post | null>(null)

function open(post: Post) {
  openPost.value = post
}

function close() {
  openPost.value = null
}

export function usePostModal() {
  return { openPost, open, close }
}
