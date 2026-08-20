// Preset swatch data for the custom-group color picker (task 037/039).
// Values, not theme tokens: a group's color is a user choice stored on the
// wire (server's groups.color, #RRGGBB or null), unrelated to the light/dark
// CSS variable palette elsewhere in this app - hardcoding hex here is the
// correct call, not a token-system violation.
//
// The 16 swatches are Mew's original topic-icon color board, traditional
// Japanese color names, recovered by docs/mew-gui-archaeology.md §4.2
// (archaeology task 003) from cdn.mew.fun/spacelize/preset/icons.
export interface GroupColorSwatch {
  key: string
  name: string
  hex: string
}

export const GROUP_COLOR_SWATCHES: GroupColorSwatch[] = [
  { key: 'ruri', name: '琉璃', hex: '#2151a2' },
  { key: 'yamabuki', name: '山吹', hex: '#f2ab31' },
  { key: 'terigaki', name: '照柿', hex: '#af5d3e' },
  { key: 'tsuyukusa', name: '露草', hex: '#4b9dd7' },
  { key: 'entan', name: '铅丹', hex: '#c0544d' },
  { key: 'seiji', name: '青磁', hex: '#6da4a2' },
  { key: 'kikyo', name: '桔梗', hex: '#5b468e' },
  { key: 'wakatake', name: '若竹', hex: '#649f78' },
  { key: 'kurumi', name: '胡桃', hex: '#857063' },
  { key: 'benimidori', name: '红碧', hex: '#7485c9' },
  { key: 'tokusa', name: '木贼', hex: '#356143' },
  { key: 'kohaku', name: '琥珀', hex: '#b7732f' },
  { key: 'kyara', name: '伽罗', hex: '#684c29' },
  { key: 'ichigo', name: '莓', hex: '#9f4851' },
  { key: 'araisyu', name: '洗朱', hex: '#eb9167' },
  { key: 'momo', name: '桃', hex: '#e591a0' },
]
