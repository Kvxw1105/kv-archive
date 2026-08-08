# TASK-008 — Scheduled incremental backup and content-addressed snapshots

Status: COMPLETED LOCALLY / REAL LOGGED-IN ALARM ACCEPTANCE PENDING
Version: 0.9.0
Date: 2026-07-26

## Original target

Create a complete 7A+7B slice: recurring incremental backup, startup catch-up, no redundant detail downloads, durable recovery, content-addressed objects, logical snapshots, retention, and safe reclamation. Do not begin 7C/7D as half-finished work.

## Delivered

- local-time daily/3-day/weekly/30-day schedules;
- Chrome alarms, install/startup reconciliation, overdue catch-up;
- durable lease shared by scheduled/manual/archive paths;
- idle deferral, retry backoff, bounded alarm slices, continuation checkpoints, heartbeat and notifications;
- fresh metadata scan on every scheduled cycle, including warning-completed jobs;
- deleted/moved current-reference reconciliation;
- references-only scheduled attachment default;
- SHA-256 conversation/asset content objects and lazy legacy migration;
- non-duplicating logical snapshot fingerprints and deltas;
- retention and cross-account-safe garbage collection;
- scheduler UI with next/last/status/snapshot/delta/dedup metrics.

## Verification

- `npm test`: 106/106 passed;
- `npm run typecheck`: passed;
- `npm run test:performance`: 1,200 conversations, 172,356,458 ZIP bytes, one concurrent artifact read;
- `npm run test:snapshot-performance`: 3,000 conversations, 600 asset references, 200 changes, unchanged-state suppression, 200 objects reclaimed.

## Remaining acceptance

Run a real scheduled cycle and browser-startup catch-up against a logged-in ChatGPT account. Browser and ChatGPT private-endpoint behavior cannot be fully exercised in the container.

## Explicit boundary

Conversation object dedup is full-payload granularity. Message-level chunk dedup is not implemented or claimed.
