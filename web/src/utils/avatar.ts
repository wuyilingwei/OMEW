// deterministic placeholder avatar: same seed always yields the same hue + initial
function hashSeed(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

export function avatarBackground(seed: string): string {
  const hue = hashSeed(seed) % 360
  return `hsl(${hue} 58% 42%)`
}

export function avatarInitial(seed: string): string {
  return seed.trim().charAt(0).toUpperCase() || '?'
}
