import { describe, expect, it } from 'vitest'
import rosterSource from '../web/src/components/StrongholdMemberRoster.vue?raw'
import cardSource from '../web/src/components/MemberInfoCard.vue?raw'
import messagesSource from '../web/src/components/DirectMessagePanel.vue?raw'

describe('member roster actions', () => {
  it('searches and expands the matching member inline', () => {
    expect(rosterSource).toContain('type="search"')
    expect(rosterSource).toContain('searchQuery')
    expect(rosterSource).toContain('expandedActor')
    expect(rosterSource).toContain('<MemberInfoCard')
    expect(rosterSource).not.toContain('member-roster__presence-note')
  })

  it('keeps profile actions in the card and messaging in a separate component', () => {
    expect(cardSource).toContain(':disabled="inline"')
    expect(cardSource).toContain('解除拉黑')
    expect(cardSource).toContain('<DirectMessagePanel')
    expect(messagesSource).toContain('sendDirectMessage')
    expect(messagesSource).toContain('DIRECT_MESSAGE_BLOCKED')
  })
})
