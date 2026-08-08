# KV Archive v0.11.2 — Interface Upgrade

v0.11.2 is a presentation and interaction release. It turns the extension's separate utility pages into one coherent KV Archive workspace while preserving the locally verified v0.11.1 product behavior.

## User-facing changes

- Unified indexed side navigation across the five full-page centers.
- New popup command center with clearer primary and secondary actions.
- Rebuilt Backup Center hierarchy for workspace selection, automation, progress, capability reference, and run history.
- Rebuilt Library search/results workspace.
- Rebuilt Project State review workspace.
- Rebuilt Memory Sync compiler/diff workspace.
- Rebuilt Obsidian export compiler, metrics, preview, and quality gate.
- Responsive mobile reorganization rather than desktop-scale shrinking.
- Calibrated light and dark themes, visible keyboard focus, and reduced-motion support.
- User-facing product name updated to KV Archive.

## Technical boundaries

- No database migration.
- No new permissions.
- No remote font, CDN, analytics, WebGL, or network dependency.
- No change to export formats, backup logic, state governance, memory approval, Agent protocol, or Obsidian graph semantics.
- Historical internal identifiers may remain for compatibility.

## Verification

- 130/130 automated tests passed.
- All original JavaScript-consumed HTML IDs were preserved exactly.
- 22 static Chromium render cases passed without horizontal overflow or missing assets.
- Final loaded-extension/live-account acceptance remains pending.
