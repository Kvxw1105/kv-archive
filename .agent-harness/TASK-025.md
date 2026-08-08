# TASK-025 · Bulk Capture Control & Partial Export

Status: `LOCALLY_VERIFIED`

## Goal

Make large selected-conversation capture interruptible, resumable and partially deliverable without conflating durable browser capture with local ZIP export.

## Completed

- separate Capture and Local Export stages;
- cooperative pause/resume and pause-then-export;
- durable artifact reconciliation after stale checkpoints;
- read-only partial export snapshots with explicit progress;
- bounded per-conversation timeout and retry ceiling;
- pause-aware retry cancellation without false failures;
- failed-item isolation and later retry;
- chunked catalog and selected-item rendering;
- 247/247 automated tests and all established performance smokes.

## Protected contracts

- pausing/exporting cannot delete or rewrite durable artifacts;
- partial export cannot mutate the source task;
- “saved” requires an artifact committed to browser storage;
- complete archive compatibility and low-memory volume behavior remain intact;
- no automatic ZIP generation after capture;
- no database migration in v0.16.2.

## Remaining

- real logged-in Chrome large-account acceptance;
- real pause latency and browser restart recovery;
- real partial/multi-volume downloads and manifest inspection;
- Git/CI/release.
