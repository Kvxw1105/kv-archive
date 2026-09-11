# KV Archive Handoff — GitHub / Local Agent Transition

Date: 2026-08-09  
Baseline: v0.16.11  
Mode: BOOTSTRAPPED → real-browser acceptance (TASK-031)

## Goal

Move KV Archive from ZIP/chat-session development into a durable public GitHub repository with local-Agent implementation, reproducible CI, machine-readable state and explicit acceptance gates.

## What is already true

- The v0.16.11 source baseline existed and had 294/294 local regression PASS, typecheck PASS and 7/7 performance-gate PASS before this governance transition.
- Source had no `.git` metadata.
- The public seed removes generated dist outputs and anonymizes unrelated synthetic example names before the first public history.
- Product north star, master PRD, acceptance standards, roadmap, governance, public-repo policy and Agent prompts are included in this seed.

## Bootstrap result (TASK-030, 2026-08-09)

- Public repository: https://github.com/Kvxw1105/kv-archive (branch `main`).
- Baseline commit: `6d1028eb7b678147f59f0d6d303da5495fd2e399`.
- CI: run `31276928345` green on baseline SHA (npm ci + typecheck + npm test).
- Release: `v0.16.11` pre-release at https://github.com/Kvxw1105/kv-archive/releases/tag/v0.16.11
- Seed fix during re-validation: `package.json` gained `devDependencies.typescript@^5` (missing dependency declaration) and `packages/knowledge-graph/src/index.ts:255` gained a `BufferSource` cast required by TypeScript 5.7+ TypedArray generics. Runtime behavior unchanged.

## What must happen next

TASK-030 must create the public repository without silently changing product behavior. It must re-run the baseline tests after the public-seed sanitization, perform a privacy/secret preflight, create the first commit, push, confirm CI and report the exact repository URL/head SHA.

## Protection

- Do not publish owner data or browser databases.
- Do not auto-add a project license.
- Do not implement new product features during repository bootstrap.
- Do not rewrite existing runtime contracts merely to make the repository look cleaner.
- Preserve third-party notices/licenses.

## Seven-level state at handoff

- EDITED: repo-ready seed/docs prepared.
- LOCALLY_VERIFIED: prepared GitHub seed passed npm ci, typecheck, 294/294 tests and all seven performance gates.
- COMMITTED: yes — baseline commit `6d1028e`.
- PUSHED: yes — main at https://github.com/Kvxw1105/kv-archive.
- PR_UPDATED: n/a for baseline import; all follow-up changes use branch/PR.
- CI_PASSED: yes — run `31276928345` green.
- RELEASED: `v0.16.11` pre-release (not stable; owner-profile acceptance pending).

## Start instruction

TASK-030 is complete. Next: execute `.agent-harness/prompts/01_REAL_BROWSER_ACCEPTANCE.md` as TASK-031 (real-browser reliability acceptance; fix only reproduced defects).

## TASK-031 progress (2026-08-11)

- A (in-place upgrade + data preserved): OBSERVED PASS.
- B (scheduler UI): OBSERVED PASS — no `Cannot set properties of undefined`; logical snapshot 1 at start.
- E (10-min Alarm): OBSERVED PASS — Alarm fired exactly at dueAt 02:12:05 (UTC 18:12:05Z), automatic incremental completed (slice-complete) at 18:13:27Z.
- C (incremental detection): OBSERVED PASS — 02:41 run success in 28s, 99 conversations processed, new snapshot created (logical snapshots 1→3), UI 上次成功 02:42:03.
- Reproduced defect: incremental job could hang forever in `project-conversations` phase when `chrome.scripting.executeScript` never resolves (busy/unresponsive ChatGPT tab; no timeout, no cancel). Fixed via `executeScriptWithTimeout` (60s, 408 retryable) on all 5 call sites; +2 regression tests; typecheck PASS; 297/297 tests PASS.
- PR #3 open: https://github.com/Kvxw1105/kv-archive/pull/3 (verify check green).
- Remaining for TASK-031: second-conversation reuse evidence (本轮复用节省), missed-schedule catch-up (错过补跑), large-library measurements.
- Evidence log: `.agent-harness/evidence/TASK-031-AB-EVIDENCE.md` (redacted).

## TASK-031 closure pass (2026-09-10)

- Revalidated PR #3 baseline: branch `fix/stuck-project-conversation-indexing`, local HEAD `1fd73576ae04a9b42e3236499a63857f37a63606`, PR OPEN/CLEAN, prior `verify` SUCCESS.
- Current local build and deterministic evidence are complete: typecheck PASS, 297/297 tests PASS, history timeout regression PASS, scheduler transition tests PASS, 10,000-node chunk smoke reused 9,999 nodes, and all required performance gates PASS.
- Created a private rollback copy of the currently loaded unpacked extension and copied the current build over the same path without uninstalling or clearing IndexedDB. The owner must click Chrome Reload to activate the copied build; the browser bridge cannot inspect `chrome-extension://` pages.
- Remaining owner actions are deliberately bounded: export a fresh recovery package, reload and confirm preservation, run the second continuation/reuse proof, recheck fresh-page Backup Center terminal convergence, measure real search/Project export, and perform missed-schedule close/reopen catch-up. Do not close Chrome until unrelated work is clear and the owner confirms the timing window.
- TASK-031 remains in progress; no merge, release, or CI result for a new commit is claimed.

## Scheduled backup primary card (2026-09-11)

- Scheduled incremental backup is now an always-visible Backup Center primary card; status, next/last run, reuse evidence, and immediate action no longer require expanding an advanced drawer. Settings and the 10-minute acceptance tool remain progressively disclosed. Scheduler storage/alarm contracts and DB v13 are unchanged.
- Verification: `npm run typecheck` PASS; `npm run build:extension` PASS with manifest `0.16.11`; full deterministic suite PASS (`301/301`). Owner-profile Reload and desktop/narrow visual acceptance are still pending observation; do not claim them from source or build evidence.

## Conversation Basket provider classification (2026-09-11)

- Conversation Basket now restores every locally cached provider catalog and offers platform-aware grouping/filtering. ChatGPT remains the only verified batch full-history collector; unsupported or mixed-platform selections stop with an explicit explanation instead of entering the ChatGPT-only engine. IndexedDB v13 and existing selection keys remain unchanged.
- Verification: focused provider/catalog/selection/UI regressions PASS; `npm run typecheck` PASS; `npm run build:extension` PASS at manifest `0.16.11`; `npm test` PASS. The user-owned unstaged `tests/pwa.test.mjs` change remains preserved.
- Delivery: COMMITTED at `4c244bb1584673c225e8e93c59ec0d23de18bdb9`; PUSHED to `fix/stuck-project-conversation-indexing`; PR #3 remains OPEN with matching head; `verify` passed in run `34616452548`. Do not merge or release.
