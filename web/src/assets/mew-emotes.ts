// Built-in emote packs - bundled client-side (Vite-hashed asset URLs), no
// server round trip and no instance seeding required. Always present alongside
// whatever custom packs the instance's GET /api/emotes returns.
import type { EmotePack } from '../api/types'
import { REACTION_SET, STAMP_EMOTES } from './mew'

function toPack(id: string, name: string, display: string, source: Record<string, string>): EmotePack {
  return {
    id,
    name,
    display,
    emotes: Object.entries(source).map(([emoteName, url]) => ({
      id: `${id}-${emoteName}`,
      name: emoteName,
      media_id: `${id}-${emoteName}`,
      url,
    })),
  }
}

// the two halves of the forum's emote set: the reaction glyphs, which double as
// the reaction picker's vocabulary, and the 4x3 standard stickers. Both are
// sendable as messages, so both are packs. Same twelve names on each side, but
// the pack name keeps their :pack:name: codes apart.
export const BUILTIN_REACTION_PACK = toPack('builtin-reaction', 'reaction', '反应', REACTION_SET)
export const BUILTIN_EMOTE_PACK = toPack('builtin-mew', 'mew', '标准表情', STAMP_EMOTES)

export const BUILTIN_PACK_IDS = [BUILTIN_REACTION_PACK.id, BUILTIN_EMOTE_PACK.id]

// name -> bundled asset URL, consumed directly by the reaction picker (which
// attaches a reaction rather than sending an emote).
export const BUILTIN_REACTION_SET = REACTION_SET
