# KV Archive Current State

Baseline version: `0.16.11`  
Engineering state: `CI_PASSED`  
Transition node: `GITHUB_AND_LOCAL_AGENT_HANDOFF_READY`  
Date: `2026-08-09`  
Repository: `https://github.com/Kvxw1105/kv-archive` (public, branch `main`)  
Baseline commit: `6d1028eb7b678147f59f0d6d303da5495fd2e399`  
CI run: `31276928345` — https://github.com/Kvxw1105/kv-archive/actions/runs/31276928345  
Release: `v0.16.11` pre-release — https://github.com/Kvxw1105/kv-archive/releases/tag/v0.16.11  
Branch protection: ruleset `main-protection` active (pull_request + non_fast_forward + required `verify` check)

## TASK-031 closure pass (2026-09-10)

- Branch/PR baseline remains `fix/stuck-project-conversation-indexing` at `1fd73576ae04a9b42e3236499a63857f37a63606`; PR #3 is OPEN/CLEAN with prior `verify` SUCCESS.
- Local verification is current: `npm ci`, typecheck, 297/297 deterministic tests, focused timeout/chunk/scheduler tests, 10,000-node reuse smoke (`9,999` reused), and all required performance gates passed.
- The current extension build was copied over the existing unpacked-extension directory after a private rollback copy was created; extension ID and version remain unchanged, and no uninstall or IndexedDB clearing occurred. Owner Reload is still required before treating the copy as loaded.
- TASK-031 remains IN PROGRESS. Real owner-profile proof is still pending for second-continuation physical reuse, fresh-page Backup Center terminal convergence, missed-schedule catch-up across Chrome close/reopen, and real large-library search/Project export latency. No CI claim is made for a new SHA until the scoped commit is pushed.

## Verified baseline facts

- v0.16.11 locally passed 294/294 deterministic tests, TypeScript validation and seven performance gates before the development-mode transition.
- Changed ChatGPT conversations can use content-addressed mapping nodes, mapping-reference chunks and a v2 manifest while legacy whole-conversation objects remain readable.
- Scheduled/incremental backup, logical snapshots, bounded/scoped reads, Notes PWA Alpha, Project State, Memory Gate, Obsidian, Portable Capture and Verified Handoff exist in the codebase.
- Extension DB baseline is v13; Notes PWA DB baseline is v1.
- Source packages arrived without `.git` history.

## Development-mode decision

The long ChatGPT web conversation is no longer the primary coding workspace. The next engineering source of truth should be a public GitHub repository maintained by local Agents and reviewed through branch/PR/CI evidence.

## Protected contracts

- Raw Evidence and Evidence URI semantics.
- Legacy archive/snapshot/Portable Capture/Agent Bundle compatibility.
- Project State / approved Memory governance.
- No eager migration of the owner corpus solely for metrics or convenience.
- No brute-force merge of the separate note-app frontend.
- No project-level license selection without owner approval.
- No real owner conversations, browser databases or credentials in public Git history.

## External acceptance still pending

- ~~Owner-profile Chrome in-place v0.16.10 → v0.16.11 acceptance~~ → **IN PROGRESS (TASK-031)**:
  - A (in-place + data preserved): OBSERVED PASS (2026-08-11).
  - B (scheduler UI): OBSERVED PASS — no `Cannot set properties of undefined`; logical snapshot 1.
  - E (10-min Alarm): OBSERVED PASS — Alarm fired exactly at dueAt 02:12:05; incremental completed (slice-complete).
  - C (incremental detection): OBSERVED PASS — run at 02:41 completed success in 28s, 99 conversations processed, new snapshot created, logical snapshots 1 → 3.
  - C defect found + fixed: incremental job could hang forever in `project-conversations` phase when `chrome.scripting.executeScript` never resolves (busy/unresponsive ChatGPT tab). Fix: `executeScriptWithTimeout` (60s, 408 retryable) on all 5 call sites. Branch `fix/stuck-project-conversation-indexing`, PR #3, CI green.
  - C second-round reuse evidence (本轮复用节省): **BLOCKED in this session** — owner sent a test message via bridge (2nd continuation) but the Backup Center start/run buttons were non-responsive in the stale "正在自动增量" panel; needs a fresh page load / extension reload and a manual run.
  - D (snapshot history): partial — new snapshot created while old retained (1→3), no missing-content errors.
  - Gate C (large library): code-level evidence supports bounded search/detail reads (load-more paging, batch detail). Real latency measurements pending.
  - UI stale-state observation: acceptance panel showed "正在自动增量" after completion (data layer completed); cosmetic display issue, flagged for follow-up.
  - Remaining: reuse evidence after reload, missed-schedule catch-up.
- ~~Real scheduler UI / 10-minute Alarm / missed-run catch-up~~ → **10-min Alarm PASS; missed-run catch-up pending**.
- ~~Real old long conversation continued twice with observed node reuse~~ → **first continuation observed (99 conversations processed); positive node/byte reuse pending after reload**.
- Real large-library search/Project export measurements.
- Real mobile PWA, Obsidian and external-Agent acceptance.
- Git commit/push/PR/CI/release evidence after repository bootstrap → **PR #3 OPEN (fix), CI green; branch protection active**.

## Active sequence

1. TASK-030 — create/sanitize/push the public GitHub baseline and establish CI. ✅
2. TASK-031 — real-browser reliability acceptance; fix only reproduced defects. **IN PROGRESS**
   - A/B/E/C-OBSERVED PASS; defect (stuck incremental) found, fixed, PR #3 open.
3. TASK-032 — freeze/audit the separate note-app prototype and design the Integration Bridge. (next)

## Current completion levels

- EDITED: handoff/governance seed prepared outside Git history.
- LOCALLY_VERIFIED: prepared GitHub seed revalidated: npm ci PASS, typecheck PASS, 294/294 tests PASS, 7/7 performance gates PASS.
- COMMITTED: yes — baseline commit `6d1028e` on `main`; fix commit `600b102` + docs `0bee498` on `fix/stuck-project-conversation-indexing`.
- PUSHED: yes — https://github.com/Kvxw1105/kv-archive; fix branch pushed.
- PR_UPDATED: **PR #3** open (fix: bound executeScript calls) — https://github.com/Kvxw1105/kv-archive/pull/3.
- CI_PASSED: yes — baseline run `31276928345` green; PR #3 verify run `31417157329` green.
- RELEASED: `v0.16.11` pre-release created (owner-profile acceptance in progress; A/B/E/C observed PASS).
