// Built-in emote packs - bundled client-side (Vite-hashed asset URLs), no
// server round trip and no instance seeding required. Always present alongside
// whatever custom packs the instance's GET /api/emotes returns.
import type { EmotePack } from '../api/types'
import { REACTION_SET, STAMP_EMOTES } from './mew'

export type BuiltinEmotePackKind = 'reaction' | 'standard'

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

// The two built-in sets use separate token namespaces even though their twelve
// semantic names match.
export const BUILTIN_REACTION_PACK = toPack('builtin-reaction', 'reaction', '反应', REACTION_SET)
export const BUILTIN_EMOTE_PACK = toPack('builtin-mew', 'mew', '标准表情', STAMP_EMOTES)

export const BUILTIN_PACK_IDS = [BUILTIN_REACTION_PACK.id, BUILTIN_EMOTE_PACK.id]

const BUILTIN_PACK_KINDS: Record<string, BuiltinEmotePackKind> = {
  [BUILTIN_REACTION_PACK.id]: 'reaction',
  [BUILTIN_EMOTE_PACK.id]: 'standard',
}

export function builtinEmotePackKind(packId: string): BuiltinEmotePackKind | null {
  return BUILTIN_PACK_KINDS[packId] ?? null
}

export function isCompactStandaloneEmote(packName: string): boolean {
  return packName === BUILTIN_REACTION_PACK.name
}

// name -> bundled asset URL, consumed directly by the reaction picker (which
// attaches a reaction rather than sending an emote).
export const BUILTIN_REACTION_SET = REACTION_SET
