# KV Archive v0.16.6 — Adaptive Theme GUI

State: `LOCALLY_VERIFIED`

v0.16.6 adds one semantic appearance system across the browser extension and Notes PWA.

## User-visible changes

- Three appearance modes: Follow system, Light, Dark.
- The choice persists across extension pages and popup openings.
- Follow-system mode reacts to operating-system appearance changes while the page is open.
- A no-flash bootstrap resolves the theme before page styles load.
- Full-page workspaces expose the appearance control in the left rail.
- The popup exposes a compact three-way appearance control.
- Notes PWA exposes a header quick-cycle button and a full appearance control under Tools.
- Light mode uses warm paper surfaces and dark green controls; dark mode preserves the black-green archive-room identity.
- Task feedback, forms, cards, tables, dialogs, navigation, scrollbars and code/editor surfaces use shared semantic tokens.
- Theme controls support `aria-pressed`, keyboard arrow/Home/End navigation and reduced-motion preferences.

## Compatibility and data safety

- No IndexedDB migration.
- No archive, Bundle, Portable Capture, Memory Gate or Project State contract changes.
- The selected mode is stored only in local browser storage under `kv-archive-theme-mode`.
- Existing business actions and routes are unchanged.

## Verification boundary

The source, build, tests, CSS parsing, contrast checks and performance gates passed locally. Real Chrome visual acceptance on the owner's displays remains pending because the container Chromium process could not produce a trustworthy screenshot session.
