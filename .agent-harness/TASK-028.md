# TASK-028 — Handoff Truth & Scoped Storage Hardening

Status: `LOCALLY_VERIFIED`
Version: `0.16.10`
Date: `2026-08-08`

## Goal

Remove stale Agent handoff instructions and ensure Project-scoped export/update paths are scoped at the IndexedDB read boundary, while preventing Notes PWA upgrades from deleting unrelated same-origin caches.

## Delivered

- replaced obsolete root project instructions with a stable current architecture/data contract;
- advanced `.agent-harness/CURRENT_STATE.md` from stale v0.16.2 to v0.16.10;
- Project Agent export uses `projectId` indexes/primary key for conversations, Capture items and State;
- Extension/PWA Capture version export uses `captureVersions.objectId` bounded reads for selected objects;
- PWA Service Worker cache deletion is namespaced to `kv-archive-notes-*`;
- package-builder fallback metadata now reports v0.16.10;
- no IndexedDB migration or public package schema change;
- 287/287 regression tests, typecheck and established performance gates pass locally.

## Acceptance boundaries

Local automation cannot prove owner-profile Chrome memory use, mobile browser Service Worker lifecycle, same-origin multi-app cache coexistence or external Agent behavior. Use `REAL_V0.16.10_ACCEPTANCE.md` before wider Alpha distribution.
