import type { ItemReactions } from '../api/types'

// Shared by useChatRoom/useSectionRoom: applying an optimistic toggle and
// rolling one back are the same shape, just opposite ops.
export function applyReactionToggle(reactions: ItemReactions | undefined, name: string, op: 'add' | 'remove'): ItemReactions {
  const mine = new Set(reactions?.mine ?? [])
  const entries = [...(reactions?.entries ?? [])]
  const idx = entries.findIndex((e) => e.name === name)
  if (op === 'add') {
    mine.add(name)
    if (idx >= 0) entries[idx] = { ...entries[idx]!, count: entries[idx]!.count + 1 }
    else entries.push({ name, count: 1 })
  } else {
    mine.delete(name)
    if (idx >= 0) {
      const nextCount = entries[idx]!.count - 1
      if (nextCount > 0) entries[idx] = { ...entries[idx]!, count: nextCount }
      else entries.splice(idx, 1)
    }
  }
  return { entries, mine: [...mine] }
}

export function invertReactionOp(op: 'add' | 'remove'): 'add' | 'remove' {
  return op === 'add' ? 'remove' : 'add'
}
