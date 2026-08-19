// Built-in default emote pack - bundled client-side (Vite-hashed asset URLs),
// no server round trip and no instance seeding required. Always present
// alongside whatever custom packs the instance's GET /api/emotes returns.
import type { EmotePack } from '../api/types'
import { MASCOT_EMOTES } from './mew'

export const BUILTIN_EMOTE_PACK: EmotePack = {
  id: 'builtin-mew',
  name: 'mew',
  display: 'NiuBi 一家',
  emotes: Object.entries(MASCOT_EMOTES).map(([name, url]) => ({
    id: `builtin-${name}`,
    name,
    media_id: `builtin-${name}`,
    url,
  })),
}
