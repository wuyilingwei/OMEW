import { DEFAULT_AVATARS } from '../assets/mew'

// deterministic default-avatar pick: same seed always yields the same image
function hashSeed(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

export function defaultAvatarUrl(seed: string): string {
  return DEFAULT_AVATARS[hashSeed(seed) % DEFAULT_AVATARS.length]!
}
