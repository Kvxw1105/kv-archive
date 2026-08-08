# TASK-023 · Portable Capture Package & Recovery

Status: `LOCALLY_VERIFIED`

## Goal

Make the editable Capture / Note layer safely portable and recoverable without using Agent Bundle as a restore format or rewriting immutable Raw Evidence.

## Completed

- deterministic scoped Portable Capture package and stored ZIP codec;
- exact payload, object, version and Evidence hash validation;
- Project and unbound scope validation;
- zero-write dry-run import planner;
- atomic conflict blocking for Project, revision, lineage and immutable IDs;
- identical-record skip and lineage-proven fast-forward;
- append-only import/no-change/rollback receipts;
- bounded rollback with later-edit and dependency guards;
- Capture Center export, analyze, confirm, receipt and rollback UI;
- IndexedDB schema 12 recovery receipt store;
- 219/219 tests and four performance smokes.

## Protected contracts

- Raw Evidence `content-objects` is excluded and immutable;
- approved Project State is excluded and never mutated;
- no partial apply after a blocking conflict;
- rollback only affects records enumerated by the receipt;
- current version and immutable history must remain hash-verifiable;
- existing Agent Bundle and low-memory backup behavior remain compatible.

## Remaining

- real Chrome IndexedDB 11 → 12 acceptance;
- real ZIP/file-picker and download behavior;
- real package import, conflict and rollback lifecycle;
- binary attachment recovery contract;
- Git/CI/release.
