# TASK-007 — Large-corpus backup stability

Status: COMPLETED LOCALLY / REAL FAILING CORPUS RERUN PENDING
Version: 0.8.1
Date: 2026-07-26

## Observed defect

A real user run with a large corpus caused progress to appear frozen and eventually exhausted the browser process.

## Root causes confirmed in code

1. Repeated full-corpus UI/stat work and an unbounded log.
2. Excessive cloning and persistence of growing task arrays.
3. Bulk attachment/artifact paths.
4. All-at-once archive and multi-volume retention.
5. Automatic transition from collection to archive generation.
6. Duplicate JSON/base64 representations during transport.
7. O(conversations × assets) archive association work.

## Delivered

- Bounded UI and phase heartbeat.
- Batched checkpoints and durable-progress reconciliation.
- Incremental inventory and IndexedDB iteration.
- Metadata-only archive planning.
- One-volume-at-a-time Blob ZIP generation and download confirmation.
- Resumable volume checkpoints.
- Adaptive 12–24 MB archive target and 16–32 MB single-asset safety cap.
- Compact manifest and paginated archive index.
- Direct JSON parsing and chunk decoding with reduced temporary duplication.

## Verification

- Typecheck passed.
- 82/82 automated tests passed.
- 1,200-conversation pressure run completed.
- Approximate output: 171,158,858 bytes across 29 volumes.
- Maximum concurrent artifact reads: 1.
- Peak heap delta: 15,240,712 bytes.
- Peak RSS delta: 74,903,552 bytes.

## Remaining acceptance

Rerun the user's exact previously failing corpus in the installed browser extension.
