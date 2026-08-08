# TASK-029 — Incremental Conversation Node Dedup & Scheduler UI Recovery

Status: `LOCALLY_VERIFIED`
Version target: `0.16.11`
Date: `2026-08-08`

## Goal

Fix the real scheduled-backup status rendering defect and make an updated ChatGPT conversation reuse unchanged raw mapping nodes across logical snapshots instead of writing another complete raw Conversation payload.

## Delivered behavior

- Scheduler 10-minute countdown/progress controls are registered and guarded.
- Chunkable ChatGPT raw conversations use content-addressed mapping-node objects, fixed-size mapping-reference chunks and a v2 manifest.
- Appending messages reuses every unchanged node object key; only changed/new nodes, affected reference chunks and the manifest need new objects.
- `getArtifact()` reconstructs the original raw conversation exactly and keeps legacy whole-conversation reads.
- Snapshot GC follows transitive object references before deletion.
- Per-cycle reuse metrics are carried into logical snapshots and Backup Center status.
- No IndexedDB schema bump, Evidence URI change, Agent Bundle schema change or destructive migration.

## Verification

- targeted scheduler/chunk/GC regressions: PASS;
- full `npm test`: 294/294 PASS;
- `npm run typecheck`: PASS;
- six established performance gates: PASS;
- new 10,000-node continued-conversation reuse gate: PASS (9,999/10,000 prior nodes reused; 3 node objects + 1 mapping chunk + 1 manifest newly required).

## Remaining real acceptance

Use `REAL_V0.16.11_ACCEPTANCE.md`. The first post-upgrade update of a legacy whole-conversation object seeds chunks; subsequent updates are the meaningful reuse test.
