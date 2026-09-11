# Scheduled Incremental Backup Primary Card Design

Date: 2026-09-11
Status: Approved design
Scope: KV Archive extension Backup Center

## Goal

Make scheduled incremental backup a first-class, immediately understandable Backup Center capability. A user opening the page must be able to answer, without expanding any disclosure:

1. Is automatic backup enabled?
2. Is it healthy, running, waiting, or blocked?
3. When will it run next and when did it last succeed?
4. What is the primary action right now?

This is an information-architecture and presentation change. The current scheduler, IndexedDB stores, alarms, retention behavior, and backup engine remain authoritative and unchanged unless implementation uncovers a reproducible defect.

## Current problem

The whole scheduler experience is nested inside an advanced `<details>` surface. Its switch, status, next run, last success, reuse metrics, manual incremental action, and recovery guidance are invisible until the user discovers and opens that disclosure. The placement makes an existing core reliability capability feel optional or unfinished.

The ten-minute acceptance panel also occupies substantial space inside the same surface, giving an engineering validation tool similar visual priority to the user's normal backup workflow.

## Chosen approach

Promote scheduled incremental backup to an always-visible primary card immediately below `BACKUP HEALTH`. Keep the operational summary and everyday actions visible. Move configuration fields into an internal disclosure named `调整自动备份设置`, and move the ten-minute test into a separate internal disclosure named `验收工具`.

This approach is preferred over merely opening the existing disclosure by default because it fixes the information hierarchy instead of changing only the initial expansion state. It is preferred over adding another popup entry because Backup Center should first become a coherent, truthful home for backup state; duplicating controls across surfaces would add synchronization and testing cost.

## Page structure

The Backup Center order becomes:

1. Page header and provenance strip.
2. `BACKUP HEALTH` card.
3. Always-visible `AUTOMATIC BACKUP` primary card.
4. Account/workspace selection.
5. Manual full-history collection and archive controls.
6. Detailed metrics and logs.

The automatic-backup card contains four layers.

### 1. Identity and state header

The left side contains:

- phase label `AUTOMATIC BACKUP`;
- heading `定时增量备份`;
- one sentence explaining that Chrome performs incremental scans and catches up after the browser returns.

The right side contains:

- a state badge derived from the durable scheduler runtime;
- the existing enable switch, labeled `自动备份`.

The state badge is presentation-only. It never infers success from elapsed time and never mutates the scheduler. Labels map as follows:

| Runtime state | Badge label | Tone |
| --- | --- | --- |
| disabled | 未开启 | neutral |
| idle | 已开启 | good |
| running | 正在备份 | active |
| waiting_for_idle | 等待浏览器空闲 | warning |
| waiting_for_other_backup | 等待其他任务 | warning |
| continuation_pending | 后台继续中 | active |
| success | 运行正常 | good |
| success_with_warnings | 有待处理项 | warning |
| failed | 需要处理 | danger |
| unknown/missing | 状态未知 | neutral |

### 2. Always-visible operational summary

The first row emphasizes three operational facts:

- `当前状态`;
- `下次运行`;
- `上次成功`.

A secondary row keeps useful evidence visible without competing with the primary state:

- `逻辑快照`;
- `最近变化`;
- `本轮复用节省`.

Desktop uses a three-column grid for each row. Narrow screens collapse to two columns and then one column. Labels remain readable in light, dark, and system appearance modes.

### 3. Always-visible primary actions

The action row contains:

- primary action `立即增量备份` using the existing `context-vault-schedule-run-now` path;
- secondary action `刷新状态` using the existing status-read path;
- a contextual enable action when scheduling is disabled.

The enable switch remains the single source of the desired enabled state. When disabled, the contextual button focuses or activates that switch and reveals configuration; it must not silently choose a schedule and save without the user seeing the effective settings.

During a run, the primary action displays the existing task-feedback state and is disabled only for the duration required by the current operation. Durable runtime status remains visible beside it. Failures display the existing actionable recovery message in the card rather than only in a log.

### 4. Progressive configuration and acceptance tools

`调整自动备份设置` contains the existing fields without contract changes:

- frequency;
- local run time;
- attachment policy;
- maximum snapshots;
- maximum retention days;
- idle-only behavior;
- `保存定时设置`.

The disclosure summary shows a compact human-readable configuration such as `每 3 天 · 03:30 · 仅空闲时`. This summary is derived from current form/settings values and updates after status load or save.

`验收工具` contains the entire existing ten-minute acceptance interface and describes it as an optional reliability check. Its IDs, message handling, alarm flow, countdown, and progress behavior remain intact. It is collapsed by default so ordinary users see the real product workflow first.

## Data and interaction flow

1. Page load calls the existing scheduled-backup status message.
2. `renderScheduleStatus(payload)` updates the state badge, operational summary, recovery message, configuration summary, controls, and acceptance panel from one payload.
3. The UI does not cache a separate authoritative enabled/running state; `latestSchedulePayload` remains a view cache only.
4. Saving settings continues through `context-vault-schedule-save`, followed by rendering the returned payload.
5. Manual incremental execution continues through `context-vault-schedule-run-now`, followed by a fresh status read.
6. Active ten-minute acceptance polling continues to read durable status every five seconds and stops only after observing a terminal test state.

No IndexedDB version, store, key, archive format, Evidence URI, Portable Capture, snapshot, or Agent Bundle contract changes are introduced.

## Error and recovery behavior

- A failed status read keeps the card visible and changes its badge to `状态未知`; it does not render `未开启` as a false fallback.
- A scheduler failure shows `需要处理` plus the existing sanitized `lastError` and recovery guidance.
- A missing logged-in ChatGPT tab remains an explicit actionable failure/retry condition.
- `waiting_for_idle`, `waiting_for_other_backup`, and `continuation_pending` remain distinct visible states.
- A stale page may not claim completion. Polling or a manual refresh must observe the durable terminal payload before the UI changes to success.
- Controls keep current task-feedback and disabled-state behavior; no cosmetic button is added without a working message path.

## Accessibility and visual direction

The card follows KV Archive's existing restrained archival/instrument-panel language rather than introducing a new visual theme. Its memorable element is a clear status beacon: one compact badge, one decisive action, and operational evidence aligned beneath it.

- The card uses semantic theme tokens and the existing `visibility.css` contract.
- State is communicated by text and color, never color alone.
- The switch has an explicit accessible label.
- Disclosure summaries remain keyboard-operable native `<summary>` controls.
- Disabled controls retain readable contrast.
- Motion is limited to existing progress feedback and respects reduced-motion rules.
- No new font, icon dependency, image asset, or animation library is required.

## Implementation boundaries

Expected modifications:

- `apps/extension/src/backup.html`: promote and restructure scheduler markup while preserving existing control IDs.
- `apps/extension/src/backup.css`: add primary-card, status-badge, summary hierarchy, disclosure, and responsive styles.
- `apps/extension/src/backup.js`: render the badge/configuration summary and handle the disabled-state contextual action.
- `tests/scheduled-integration.test.mjs`: prove the scheduler is no longer inside the outer advanced disclosure and all message/control wiring remains present.
- `tests/task-feedback.test.mjs` or a focused UI contract test: prove state labels, visible primary action, accessibility, and responsive structure remain wired.

Out of scope:

- scheduler algorithm changes;
- new alarms or background services;
- IndexedDB migration;
- popup duplication;
- desktop application work;
- TASK-032 note-app integration;
- automatic PR merge or release.

## Verification

Implementation is accepted only when all of the following hold:

1. Source-level regression tests prove that the automatic-backup identity, enabled state, current state, next run, last success, immediate action, and refresh action are present outside any outer advanced disclosure.
2. Existing scheduler, acceptance-mode, task-feedback, and visibility tests pass.
3. `npm run typecheck` and `npm test` pass on Windows, including the retained CRLF-compatible PWA assertion.
4. `npm run build:extension` produces a valid MV3 extension with version `0.16.11` unless a separate release decision changes it.
5. After in-place Reload, a real Backup Center page shows the card without expansion, preserves owner data, and exercises refresh and immediate incremental actions through their existing runtime paths.
6. Light, dark, narrow, and desktop layouts remain readable, with no hidden-state or contrast regressions.
7. The final diff contains no private conversation data, browser databases, credentials, tokens, signed URLs, generated debris, or unrelated modifications.

## Completion reporting

Report `EDITED`, `LOCALLY_VERIFIED`, `COMMITTED`, `PUSHED`, `PR_UPDATED`, `CI_PASSED`, and `RELEASED` separately. This UI improvement must not be called released merely because it builds or appears locally.
