// Built-in emote packs - bundled client-side (Vite-hashed asset URLs), no
// server round trip and no instance seeding required. Always present alongside
// whatever custom packs the instance's GET /api/emotes returns.
import type { EmotePack } from '../api/types'
import { REACTION_SET } from './mew'

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

// The licensed reaction glyphs are both sendable emotes and the reaction
// picker's vocabulary.
export const BUILTIN_REACTION_PACK = toPack('builtin-reaction', 'reaction', '反应', REACTION_SET)

export const BUILTIN_PACK_IDS = [BUILTIN_REACTION_PACK.id]

// name -> bundled asset URL, consumed directly by the reaction picker (which
// attaches a reaction rather than sending an emote).
export const BUILTIN_REACTION_SET = REACTION_SET
