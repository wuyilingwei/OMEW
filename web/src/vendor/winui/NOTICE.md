# NOTICE

This directory contains source vendored from **WinUIonWeb**
(https://github.com/Furry-Xiyi/WinUIonWeb), a clean-room Vue 3
reimplementation of Microsoft WinUI 3 controls. Not affiliated with or
endorsed by Microsoft.

- Author/repo: Furry-Xiyi/WinUIonWeb
- License: GPL-3.0 (verified via `GET /repos/Furry-Xiyi/WinUIonWeb` -> `license.spdx_id`)
- Snapshot: `master` branch, commit `06027b62ece0` (latest commit touching
  `WinUIonWeb/src/components` at the time of vendoring)
- Snapshot for the 2026-08-21 addition (`WinComboBox.vue`, `WinTextBox.vue`,
  `useFlyoutAnimation.ts`): `master` branch, commit `6b1e65d5101e`
- Files copied verbatim, no modifications:
  - `components/WinButton.vue`
  - `components/WinDropDownButton.vue`
  - `components/WinMenuFlyout.vue` (transitive dep of WinDropDownButton)
  - `components/WinScrollViewer.vue` (transitive dep of WinMenuFlyout)
  - `components/WinTextBlock.vue` (transitive dep of WinMenuFlyout)
  - `components/i18n/index.ts` (transitive dep of WinTextBlock)
  - `components/Strings/en-US/Resources.ts` (transitive dep of i18n/index.ts)
  - `components/Strings/zh-CN/Resources.ts` (transitive dep of i18n/index.ts)
  - `components/WinToggleSwitch.vue` (added 2026-08-19; depends only on
    `WinTextBlock` + `i18n/index.ts`, both already vendored above — no new
    transitive files)
  - `components/WinInfoBar.vue` (added 2026-08-19; depends on `WinButton` +
    `WinTextBlock`, both already vendored above — no new transitive files)
  - `components/WinSelectorBar.vue` (added 2026-08-19; zero dependencies
    beyond `vue` itself — `WinSelectorBarItem.vue` is not vendored since this
    project only uses the `:Items` array API, never the slot-children form)
  - `components/WinComboBox.vue` (added 2026-08-21; replaces native `<select>`
    for real select-a-value fields)
  - `components/WinTextBox.vue` (added 2026-08-21; transitive dep of
    `WinComboBox` for its `IsEditable` mode — this project never sets
    `IsEditable`, so `WinTextBox` never mounts)
  - `components/useFlyoutAnimation.ts` (added 2026-08-21; transitive dep of
    `WinComboBox` and `WinTextBox`, self-contained beyond `vue`)
  - `styles/theme.css` (full Fluent token layer, light + dark)
  - `styles/animations.css` (needed for `WinDropDownButton`'s chevron
    animation and `WinMenuFlyout`'s open/close motion — not optional here,
    contrary to the common case where a control's `<style>` block is
    self-contained)

`WinButton`, `WinDropDownButton`, `WinToggleSwitch`, `WinInfoBar`,
`WinSelectorBar` and `WinComboBox` are re-exported from `index.ts` for
consumption; the rest is internal plumbing pulled in by the dependency
closure and is not meant to be imported directly.

## Licensing compatibility

Host project (OpenMew) is licensed AGPL-3.0. The FSF treats GPLv3 and AGPLv3
as compatible for combination; the combined work is distributed under the
host project's license (AGPL-3.0). The vendored files themselves remain
GPL-3.0 as authored upstream — see `LICENSE` in this directory for the full
text.

## Icon font — intentionally not vendored

Upstream's `assets/Fonts/SEGOEICONS.TTF` is a Microsoft-proprietary font and
is not redistributed here. None of the vendored files need it for the way
they're used in this project:

- `WinButton` and `WinDropDownButton`'s own chevron glyph render via an
  inline SVG `mask` in `animations.css`, not the icon font.
- `WinMenuFlyout` does reference icon-font private-use codepoints
  (`\uE974`, `\uE73E`, `\uE915`) for submenu chevrons and toggle/radio check
  glyphs, but only when an item's kind is `MenuFlyoutSubItem`,
  `SplitMenuFlyoutItem`, `ToggleMenuFlyoutItem`, or `RadioMenuFlyoutItem`.
  This project only feeds it flat `MenuFlyoutItem` entries (channel names),
  so those code paths are never reached. If a future change adds
  nested/toggle menu items, add the same icon-font escape hatch used
  elsewhere in this codebase before doing so, rather than shipping a
  missing-glyph box.
- `WinToggleSwitch` renders no glyphs at all (a CSS-drawn track/knob) — no
  icon-font dependency.
- `WinInfoBar` references icon-font private-use codepoints for its severity
  icon, but this project always sets `:IsIconVisible="false"`, so that path
  is never reached.
- `WinSelectorBar` maps an `Icon` prop through icon-font codepoints
  (`iconMap` for named icons like `Add`/`Back`/`Settings`), but this project
  never passes `Icon` on any item, so that path is never reached either. If a
  future change adds icons to a selector item, add the same escape hatch
  instead of shipping a missing-glyph box.
- `WinComboBox`'s own chevron is the same CSS-drawn glyph as
  `WinDropDownButton`'s — no icon-font dependency.
- `WinTextBox` builds a cut/copy/paste/undo/redo context menu with
  icon-font codepoints (U+E8C6, U+E8C8, U+E77F, U+E7A7, U+E7A6, U+E8B3), but
  that menu only renders while `WinTextBox` itself is mounted, which only
  happens when a `WinComboBox` has `IsEditable="true"`. This project never
  sets `IsEditable` on `WinComboBox`, so `WinTextBox` never mounts and that
  code path is never reached. If a future change makes a combo box
  editable, add the same icon-font escape hatch before doing so.

## Not vendored

Everything else in WinUIonWeb (the other ~85 components, `WinSelectorBarItem`
(the `:Items` array API supersedes the need for its slot-children form here),
the icon font, the demo gallery app) was left out — only the dependency
closure actually consumed by this project was pulled in, per the project's
vendoring policy.
