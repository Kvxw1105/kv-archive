# KV Archive Current State

Baseline version: `0.16.11`  
Engineering state: `CI_PASSED`  
Transition node: `GITHUB_AND_LOCAL_AGENT_HANDOFF_READY`  
Date: `2026-08-09`  
Repository: `https://github.com/Kvxw1105/kv-archive` (public, branch `main`)  
Baseline commit: `6d1028eb7b678147f59f0d6d303da5495fd2e399`  
CI run: `31276928345` — https://github.com/Kvxw1105/kv-archive/actions/runs/31276928345  
Release: `v0.16.11` pre-release — https://github.com/Kvxw1105/kv-archive/releases/tag/v0.16.11

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

- Owner-profile Chrome in-place v0.16.10 → v0.16.11 acceptance.
- Real scheduler UI / 10-minute Alarm / missed-run catch-up.
- Real old long conversation continued twice with observed node reuse.
- Real large-library search/Project export measurements.
- Real mobile PWA, Obsidian and external-Agent acceptance.
- Git commit/push/PR/CI/release evidence after repository bootstrap.

## Active sequence

1. TASK-030 — create/sanitize/push the public GitHub baseline and establish CI.
2. TASK-031 — perform real-browser reliability acceptance; fix only reproduced defects.
3. TASK-032 — freeze/audit the separate note-app prototype and design the Integration Bridge.

## Current completion levels

- EDITED: handoff/governance seed prepared outside Git history.
- LOCALLY_VERIFIED: prepared GitHub seed revalidated: npm ci PASS, typecheck PASS, 294/294 tests PASS, 7/7 performance gates PASS.
- COMMITTED: yes — baseline commit `6d1028e` on `main`.
- PUSHED: yes — https://github.com/Kvxw1105/kv-archive
- PR_UPDATED: n/a (initial baseline import; follow-up changes use branch/PR).
- CI_PASSED: yes — run `31276928345` green on baseline SHA.
- RELEASED: `v0.16.11` pre-release created (owner-profile acceptance still pending).
