import { describe, expect, it } from 'vitest'
import messageBubbleSource from '../web/src/components/MessageBubble.vue?raw'

describe('message bubble layout contract', () => {
  it('keeps delivered timestamps as row-level siblings while pending and failed messages omit them', () => {
    expect(messageBubbleSource).toContain('class="message-row__timestamp"')
    expect(messageBubbleSource).toContain('v-if="!message.pending && !message.failed"')
    expect(messageBubbleSource).not.toContain('message-bubble__meta--timestamp')
  })

  it('keeps the timestamp on the correct side for either message direction', () => {
    expect(messageBubbleSource).toContain("'message-row--mine': message.mine")
    expect(messageBubbleSource).toContain('flex-direction: row-reverse')
    expect(messageBubbleSource).toContain('align-self: flex-end')
    expect(messageBubbleSource).toContain('opacity: 0.72')
    expect(messageBubbleSource).toContain('color: var(--text-tertiary)')
    expect(messageBubbleSource).not.toContain('.message-row--mine .message-row__timestamp')
    expect(messageBubbleSource).toContain('max-width: 80%')
    expect(messageBubbleSource).toContain('min-width: 0')
  })

  it('marks an edited message with one accessible E beside its timestamp', () => {
    expect(messageBubbleSource).toContain('class="message-row__edited"')
    expect(messageBubbleSource).toContain('aria-label="已编辑"')
    expect(messageBubbleSource).toContain('>E</span>')
    expect(messageBubbleSource).not.toContain('（已编辑）')
  })

  it('sizes standalone reaction emotes to a complete single-line bubble while preserving standard emotes', () => {
    expect(messageBubbleSource).toContain("'message-bubble__big-emote--compact': compactPureEmote")
    expect(messageBubbleSource).toContain('height: calc(1.26rem + 1rem + 2px)')
    expect(messageBubbleSource).toContain('max-width: 128px')
    expect(messageBubbleSource).toContain('max-height: 128px')
  })
})
