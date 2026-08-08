# TASK-012 — KV Archive Interface Upgrade

Status: COMPLETED_LOCALLY_VERIFIED
Version target: 0.11.2
Mode: audit-upgrade + direct-build

## Observable target

Upgrade every user-facing extension surface into one coherent KV Archive application shell without changing backup, search, state, memory, Obsidian export, database, or API behavior.

## Protected behavior

- Preserve all existing element IDs consumed by JavaScript and tests.
- Preserve routes, permissions, storage schemas, database names, event types, export formats, and internal `context-vault` compatibility identifiers.
- Do not add remote fonts, analytics, CDN assets, WebGL, or network dependencies.
- Do not delete or rewrite approved evidence, state, memory, snapshots, path maps, or user files.

## Visual proposition

Quiet archival instrument + smoked metal and warm paper + indexed navigation rails + semantic status light + restrained motion.

## Primary prototype

Industrial technical tool, with data-management as the secondary prototype.

## User timing

- 3 seconds: understand current surface and that data stays local.
- 10 seconds: find the primary action or switch to another center.
- 1–3 minutes: complete backup/search/memory/export work with visible state and recovery.

## Scope

- Shared application shell and design tokens.
- Popup command center.
- Backup, Library, State, Memory, and Obsidian surfaces.
- Responsive reorganization, keyboard focus, disabled/loading/success/error states, reduced motion.
- User-facing rename from ContextVault to KV Archive.
- Build/test/package and static browser screenshot QA.

## Non-goals

- No business-logic refactor.
- No database migration.
- No new AI or network capability.
- No direct Obsidian sync.
- No desktop app implementation.

## Acceptance

- All six surfaces share the same brand, navigation, tokens, and interaction language.
- No required JS selector is removed.
- 390px and desktop screenshots have no horizontal overflow.
- Dark and light schemes remain legible.
- Full typecheck, tests, and extension build pass.

## Completion evidence

- All six surfaces upgraded and packaged.
- Original runtime IDs preserved exactly.
- `npm test`: 130/130 passed.
- 22-case static Chromium matrix: no horizontal overflow or missing local assets.
- Real loaded-extension acceptance remains pending and is tracked in `REAL_UI_ACCEPTANCE.md`.
