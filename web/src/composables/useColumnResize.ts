// runtime-adjustable --left-width/--right-width, persisted to localStorage.
// values are clamped percentages; hydration runs once at module load (same
// top-level-side-effect pattern as useTheme.ts) so the stored width applies
// before first paint instead of flashing the CSS default.
export const LEFT_WIDTH_KEY = 'openmew-left-width'
export const RIGHT_WIDTH_KEY = 'openmew-right-width'
export const LEFT_WIDTH_DEFAULT = 26
export const RIGHT_WIDTH_DEFAULT = 17
export const WIDTH_MIN = 15
export const WIDTH_MAX = 45

export function clampWidth(value: number): number {
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, value))
}

function hydrate(storageKey: string, varName: string, fallback: number) {
  const stored = Number(localStorage.getItem(storageKey))
  const percent = Number.isFinite(stored) && stored > 0 ? clampWidth(stored) : fallback
  document.body.style.setProperty(varName, `${percent}%`)
}

hydrate(LEFT_WIDTH_KEY, '--left-width', LEFT_WIDTH_DEFAULT)
hydrate(RIGHT_WIDTH_KEY, '--right-width', RIGHT_WIDTH_DEFAULT)
