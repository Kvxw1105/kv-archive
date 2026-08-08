# ContextVault Batch 7A + 7B Verification

Version: **0.9.0**  
Date: **2026-07-26**  
Status: **LOCALLY_VERIFIED / REAL LOGGED-IN SCHEDULE ACCEPTANCE PENDING**

## Scope

This release implements one complete product slice:

- Batch 7A — scheduled incremental backup;
- Batch 7B — content-addressed conversation/asset objects and logical snapshots.

Memory injection into the ChatGPT composer and low-token usage accounting are intentionally not included in this slice; they remain Batch 7C and 7D.

## Implemented behavior

### Scheduler

- daily, every 3 days, weekly, or every 30 days at a local wall-clock time;
- Chrome alarm reconciliation at install, extension service-worker startup, browser startup, and backup-page load;
- overdue startup catch-up instead of silently skipping the missed occurrence;
- durable cross-page lease so manual backup, archive generation, and scheduled backup cannot mutate one job concurrently;
- idle-only deferral;
- bounded retry backoff at 15 minutes, 1 hour, 6 hours, and 24 hours;
- 24-second alarm slices and 45-second user-triggered slices, followed by a durable continuation alarm;
- persisted heartbeat, phase, counters, last result, last error, retry time, and next run time;
- success/failure browser notifications;
- no automatic ZIP creation during scheduled runs.

### Incremental scan

- every scheduled cycle performs a fresh lightweight list scan, including jobs previously completed with warnings;
- unchanged conversations keep their durable artifact and are not fetched again;
- conversations whose server update version changed are fetched again;
- newly discovered conversations are fetched;
- conversations no longer present in regular, archived, or Project sources are removed from the current artifact reference set;
- stale attachment references are removed from the current set;
- the default scheduled attachment policy inventories references without downloading binaries;
- optional scheduled attachment download observes the configured per-file safety limit.

### Content-addressed storage and snapshots

- conversation raw payloads use stable SHA-256 object keys;
- attachment binaries use SHA-256 object keys;
- identical objects are stored once and referenced by artifact/asset records;
- existing pre-v0.9 artifact and asset records migrate lazily when read;
- a logical snapshot records current conversation, asset, Project, unresolved-asset, and object references;
- snapshot fingerprints prevent an unchanged state from creating another snapshot;
- each changed snapshot records added, updated, removed, and unchanged conversation/asset/Project sets;
- retention is enforced by maximum snapshot count and maximum age while always preserving the latest snapshot;
- garbage collection removes only objects not referenced by the current state or any retained snapshot;
- snapshots and garbage collection remain isolated across ChatGPT workspaces/accounts.

## Verification commands and results

### Full build and automated regression

```text
npm test
```

Result:

```text
106 tests
106 passed
0 failed
```

Coverage includes scheduler normalization, startup catch-up, durable leases, idle deferral, continuation checkpoints, retry behavior, scheduled fresh scans, deleted-current-reference pruning, content hashes, unchanged snapshot suppression, deltas, retention, cross-account garbage-collection isolation, database schema, extension integration, all earlier backup/library/Agent/state paths, and low-memory archive behavior.

### Type checking

```text
npm run typecheck
```

Result: passed.

### Existing large archive regression

```text
npm run test:performance
```

Result:

- conversations: 1,200;
- approximate source text: 19,660,800 bytes;
- ZIP output: 172,356,458 bytes;
- volumes: 29;
- maximum concurrent artifact reads: 1;
- largest volume: 5,994,559 bytes;
- peak JavaScript heap increase: 21,212,984 bytes;
- peak process RSS increase: 92,135,424 bytes.

This verifies that scheduled/snapshot work did not regress the v0.8.1 bounded-memory archive path.

### Snapshot and content-addressing pressure test

```text
npm run test:snapshot-performance
```

Result:

- conversations: 3,000;
- asset references: 600;
- unique asset objects: 120;
- changed conversations in second state: 200;
- first snapshot: 31.51 ms;
- unchanged fingerprint check: 11.89 ms;
- changed snapshot: 17.37 ms;
- logical referenced bytes: 17,224,000;
- physical referenced bytes: 13,291,840;
- duplicate referenced bytes avoided: 3,932,160;
- obsolete objects reclaimed: 200;
- peak heap increase: 13,200,896 bytes;
- ending heap increase: 2,229,992 bytes.

The pressure harness fails if snapshot garbage collection bulk-loads object payloads instead of using metadata cursors.

## Adversarial checks

- duplicate scheduled trigger while another owner holds the lease;
- browser active while idle-only mode is enabled;
- missed scheduled occurrence followed by startup reconciliation;
- time slice expires before the job completes;
- completed-with-errors job must still perform a new list scan;
- conversation disappears from all current sources;
- unchanged state is scheduled again;
- snapshot retention crosses account boundaries;
- an object is referenced only by an older retained snapshot;
- manual backup exits before finding a ChatGPT tab;
- old IndexedDB schema is upgraded without deleting previous stores.

## Explicitly unverified

The container has no authenticated ChatGPT browser profile. Therefore the following are not claimed as passed:

- an alarm firing against the user's real logged-in account;
- a browser restart followed by a real catch-up request;
- real Chrome/Edge notification display;
- multi-day operation with the exact user corpus;
- current ChatGPT private endpoint changes after this build.

The substitute evidence is deterministic scheduler testing, mocked Chrome API integration, database/schema regression, full build, and synthetic pressure testing.

## Storage granularity limitation

Content addressing currently deduplicates complete conversation payload versions and attachment binaries. An unchanged conversation is reused exactly; when one message is added to a long conversation, the new complete conversation payload becomes a new evidence object so historical raw evidence remains directly reconstructable. Message-level chunk deduplication is not claimed in v0.9.0.

## Engineering state

- EDITED: yes;
- LOCALLY_VERIFIED: yes;
- COMMITTED: no;
- PUSHED: no;
- PR_UPDATED: no;
- CI_PASSED: no;
- RELEASED TO USER ENVIRONMENT: no.
