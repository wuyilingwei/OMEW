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
  feed: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z M7 9h10 M7 13h10 M7 17h5',
  chat: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z',
  home: 'M3 21V10l9-7 9 7v11 M9 21v-7h6v7',
  key: 'M15 7a4 4 0 1 0-4 4h-.5L4 17.5V20h2.5L12 14.5V13a4 4 0 0 0 3-6Z M14 8h.01',
  delete: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M15 9l-2 6-6 2 2-6 6-2Z',
} as const

// 实心图标（fill=currentColor，非描边）：分隔点等装饰性符号
export const ICON_PATHS_FILLED = {
  dot: 'M12 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z',
} as const

export type FilledIconName = keyof typeof ICON_PATHS_FILLED

export type IconName = keyof typeof ICON_PATHS
