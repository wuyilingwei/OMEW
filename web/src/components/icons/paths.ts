// Fluent 线性风格图标路径集：viewBox 统一 24x24，圆头描边，stroke=currentColor。
export const ICON_PATHS = {
  add: 'M12 5v14M5 12h14',
  'chevron-left': 'M15 18l-6-6 6-6',
  'chevron-right': 'M9 6l6 6-6 6',
  close: 'M6 6l12 12M18 6L6 18',
  emote:
    'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M9 10h.01 M15 10h.01 M8.5 14c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2',
  image:
    'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z M8 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z M4 17l5-5 3.5 3.5L16 12l5 5',
} as const

// 实心图标（fill=currentColor，非描边）：分隔点等装饰性符号
export const ICON_PATHS_FILLED = {
  dot: 'M12 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z',
} as const

export type FilledIconName = keyof typeof ICON_PATHS_FILLED

export type IconName = keyof typeof ICON_PATHS
