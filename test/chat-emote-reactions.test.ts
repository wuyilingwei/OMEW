import { describe, expect, it } from 'vitest'
import chatPaneSource from '../web/src/components/ChatPane.vue?raw'
import { standaloneEmoteToken, type EmoteToken } from '../web/src/utils/emote'

const token: EmoteToken = { pack: 'mew', name: 'like', url: '/like.webp' }
const lookup = new Map([['mew:like', token]])

describe('chat standalone emote reaction gating', () => {
  it('recognizes only a complete known emote token as a standalone emote message', () => {
    expect(standaloneEmoteToken(':mew:like:', lookup)).toEqual(token)
    expect(standaloneEmoteToken('  :mew:like:  ', lookup)).toEqual(token)
    expect(standaloneEmoteToken('收到 :mew:like:', lookup)).toBeNull()
    expect(standaloneEmoteToken(':unknown:like:', lookup)).toBeNull()
  })

  it('disables reaction controls for standalone emote messages without changing edit or retract permissions', () => {
    expect(chatPaneSource).toContain("canReact: canReactToMessage(item.body.text ?? '')")
    expect(chatPaneSource).toContain('standaloneEmoteToken(text, emoteLookup.value) === null')
    expect(chatPaneSource).toContain('if (message.seq == null || !message.canReact) return')
    expect(chatPaneSource).toContain(':can-edit="activeMessage?.editable ?? false"')
    expect(chatPaneSource).toContain(':can-retract="activeMessage?.retractable ?? false"')
  })
})
