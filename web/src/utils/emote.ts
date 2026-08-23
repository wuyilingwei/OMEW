import type { EmotePack } from '../api/types'

export interface EmoteToken {
  pack: string
  name: string
  url: string
}

export type MessageSegment = { type: 'text'; value: string } | { type: 'emote'; token: EmoteToken }

// conservative charset (no raw colon, no whitespace) - keeps the regex from
// misfiring on ordinary punctuation-heavy text ("10:30", "note: ...").
const EMOTE_RE = /:([\w-]{1,32}):([\w-]{1,32}):/g

export function buildEmoteLookup(packs: EmotePack[]): Map<string, EmoteToken> {
  const lookup = new Map<string, EmoteToken>()
  for (const pack of packs) {
    for (const emote of pack.emotes) {
      lookup.set(`${pack.name}:${emote.name}`, { pack: pack.name, name: emote.name, url: emote.url })
    }
  }
  return lookup
}

export function parseMessageText(text: string, lookup: Map<string, EmoteToken>): MessageSegment[] {
  const segments: MessageSegment[] = []
  let lastIndex = 0
  EMOTE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = EMOTE_RE.exec(text))) {
    const [full, pack, name] = match as unknown as [string, string, string]
    const token = lookup.get(`${pack}:${name}`)
    if (!token) continue
    if (match.index > lastIndex) segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    segments.push({ type: 'emote', token })
    lastIndex = match.index + full.length
  }
  if (lastIndex < text.length) segments.push({ type: 'text', value: text.slice(lastIndex) })
  return segments
}

// a message renders as one big emote image (vs. inline within text) when its
// entire trimmed content is exactly one recognized :pack:name: token.
export function pureEmoteToken(segments: MessageSegment[]): EmoteToken | null {
  return segments.length === 1 && segments[0]!.type === 'emote' ? segments[0]!.token : null
}

export function standaloneEmoteToken(text: string, lookup: Map<string, EmoteToken>): EmoteToken | null {
  return pureEmoteToken(parseMessageText(text.trim(), lookup))
}
