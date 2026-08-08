# ContextVault v0.8.1 Large-corpus Performance Hotfix — Verification

Date: 2026-07-26
Status: COMPLETED LOCALLY / REAL FAILING CORPUS RERUN DEFERRED

## User-observed defect

A real full-account backup with a large amount of data showed little or no visible progress, made the entire browser unresponsive and eventually caused Chromium to terminate the process.

## Confirmed root causes

1. The backup UI repeatedly derived full-corpus statistics and retained an unbounded DOM log.
2. Job checkpoints repeatedly cloned and rewrote growing conversation and completion arrays.
3. Attachment inventory and archive generation had bulk-loading paths.
4. Archive construction rendered and retained all conversations, binaries and ZIP volumes in the same process lifetime.
5. Collection automatically entered the most memory-intensive archive phase.
6. Large JSON and attachment transport temporarily retained duplicate representations.
7. Conversation archive rendering repeatedly scanned the complete attachment list.

## Implemented corrections

- Collection and ZIP generation are separate user-controlled stages.
- Archive planning uses metadata and one-at-a-time IndexedDB reads.
- One ZIP volume is built, downloaded and released before the next volume.
- Completed volume numbers are persisted for resume.
- Blob-part ZIP construction avoids a final full-output concatenation buffer.
- Checkpoints are batched by time and item count.
- Persisted artifacts/assets are reconciled after interrupted checkpoints.
- Progress is phase-aware and includes a two-second heartbeat monitor.
- UI rendering is throttled and logs are capped at 120 rows.
- Asset associations are pre-indexed rather than repeatedly filtered.
- JSON is parsed in page context and attachment chunks decode directly into a preallocated buffer.
- Archive root metadata is compact and the HTML index renders records in pages.

## Automated regression

Commands:

```text
npm run typecheck
npm test
```

Result:

```text
TypeScript typecheck: PASS
Automated tests: 82 / 82 PASS
```

New regressions prove:

- valid Blob-part ZIP generation;
- archive planning does not call bulk artifact or asset loaders;
- a requested volume reads only that volume's conversation descriptors;
- 360-conversation indexing uses batched checkpoints;
- collection completion does not auto-start archive generation;
- progress advances during indexing and export;
- artifacts and assets saved after the latest checkpoint are recovered;
- direct chunk decoding does not retain all base64 chunks;
- legacy backup, library, Agent and reviewed-state behavior remains intact.

## Synthetic pressure run

Command:

```text
node --expose-gc scripts/performance-smoke.mjs .tmp/performance-smoke.json
```

Corpus:

```text
Conversations: 1,200
Approximate source message text: 19,660,800 bytes
Generated ZIP data: 171,158,858 bytes
Stress volume target: 8,388,608 bytes
Volumes: 29
Largest actual volume: 5,952,643 bytes
Maximum simultaneous artifact reads: 1
Elapsed time in this container: 1,819 ms
Peak JavaScript heap delta: 15,240,712 bytes
Peak process RSS delta: 74,903,552 bytes
```

The first and final ZIP volumes were parsed and validated. The first volume contained the archive index. Bulk artifact/asset loading paths were configured to throw if called and were not called.

These measurements are evidence for bounded processing in the synthetic environment, not a guarantee that every Chromium profile, extension quota or real attachment mix has the same memory curve.

## Remaining real acceptance

- Rerun the user's previously failing full corpus with v0.8.1.
- Confirm collection reaches a terminal state without browser termination.
- Confirm the heartbeat continues during slow network/database steps.
- Confirm every sequential volume finishes and resume skips completed volume numbers.
- Record very large individual attachments that are intentionally marked incomplete by the adaptive safety cap.
