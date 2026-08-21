// Built-in default stamp pack - bundled client-side (Vite-hashed asset URLs),
// no server round trip and no instance seeding required. Always present
// alongside whatever custom packs the instance's GET /api/emotes returns.
import type { EmotePack } from '../api/types'
import { REACTION_SET, STAMP_EMOTES } from './mew'

export const BUILTIN_EMOTE_PACK: EmotePack = {
  id: 'builtin-mew',
  name: 'mew',
  display: '标准表情',
  emotes: Object.entries(STAMP_EMOTES).map(([name, url]) => ({
    id: `builtin-${name}`,
    name,
    media_id: `builtin-${name}`,
    url,
  })),
}

// Reaction glyph set - not part of any EmotePack, consumed directly by the
// message/post reaction picker (name -> bundled asset URL).
export const BUILTIN_REACTION_SET = REACTION_SET
