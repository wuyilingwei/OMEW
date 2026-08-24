import { describe, expect, it } from 'vitest'
import authModal from '../web/src/components/AuthModal.vue?raw'
import composePostModal from '../web/src/components/ComposePostModal.vue?raw'
import directoryModal from '../web/src/components/DirectoryModal.vue?raw'
import emotePicker from '../web/src/components/EmotePicker.vue?raw'
import groupEditorModal from '../web/src/components/GroupEditorModal.vue?raw'
import imageEditor from '../web/src/components/ImageEditor.vue?raw'
import memberInfoCard from '../web/src/components/MemberInfoCard.vue?raw'
import nodeRail from '../web/src/components/NodeRail.vue?raw'
import personalSettingsModal from '../web/src/components/PersonalSettingsModal.vue?raw'
import postModal from '../web/src/components/PostModal.vue?raw'
import serverAdminModal from '../web/src/components/ServerAdminModal.vue?raw'
import strongholdAdminModal from '../web/src/components/StrongholdAdminModal.vue?raw'
import winMenuFlyout from '../web/src/vendor/winui/components/WinMenuFlyout.vue?raw'

const modalSurfaces = [
  ['AuthModal', authModal, 'auth-modal'],
  ['ComposePostModal', composePostModal, 'compose-modal'],
  ['DirectoryModal', directoryModal, 'directory-modal'],
  ['GroupEditorModal', groupEditorModal, 'group-modal'],
  ['ImageEditor', imageEditor, 'image-editor'],
  ['MemberInfoCard', memberInfoCard, 'member-info-card'],
  ['NodeRail directory dialog', nodeRail, 'node-rail__dialog'],
  ['PersonalSettingsModal', personalSettingsModal, 'personal-modal'],
  ['PostModal', postModal, 'post-modal'],
  ['ServerAdminModal', serverAdminModal, 'admin-modal'],
  ['StrongholdAdminModal', strongholdAdminModal, 'admin-modal'],
] as const

function cssRule(componentSource: string, className: string): string {
  const escapedClassName = className.replaceAll('-', '\\-')
  return componentSource.match(new RegExp(`\\.${escapedClassName}\\s*\\{[^}]*\\}`))?.[0] ?? ''
}

describe('dialog surface contract', () => {
  it.each(modalSurfaces)('%s uses an opaque dialog surface for .%s', (_name, componentSource, className) => {
    const rule = cssRule(componentSource, className)

    expect(rule).toContain('background: var(--dialog-background)')
    expect(rule).not.toContain('var(--flyout-bg')
    expect(rule).not.toContain('backdrop-filter')
  })

  it('keeps anchored pickers and menu flyouts on the lighter acrylic surface', () => {
    expect(emotePicker).toContain('background: var(--flyout-bg, var(--layer-default))')
    expect(winMenuFlyout).toContain('--win-acrylic-fill: var(--flyout-bg, var(--layer-default))')
  })
})
