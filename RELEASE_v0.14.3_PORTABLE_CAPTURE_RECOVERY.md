# KV Archive v0.14.3 — Portable Capture Package & Recovery

Status: `LOCALLY_VERIFIED`

v0.14.3 gives the editable Capture / Note layer a deterministic, inspectable and reversible recovery format. It does not alter immutable conversation evidence or approved Project State.

## What is included

A Portable Capture ZIP contains:

- current editable content objects;
- every immutable content version;
- typed relations;
- operation history;
- promotion history;
- a manifest with scope, counts and payload hash.

Binary attachments, authentication data, Raw Evidence payloads and approved Project State are not included.

## Import safety

Every import runs as a dry-run first. The package is checked for:

- package schema and payload hash;
- current object content hashes;
- version key/revision/snapshot consistency;
- current revision backed by an immutable version;
- relation endpoints and Project boundaries;
- operation and promotion source objects;
- content Evidence URI hashes;
- package scope matching the contained records.

The whole import is blocked when an object id belongs to a different Project, the same revision has a different hash, immutable record ids collide, or local and incoming history have diverged.

## Safe writes and rollback

A clean plan may:

- create objects that do not exist locally;
- append missing immutable records;
- fast-forward an existing object only when the incoming history contains the exact current local revision.

Each applied import creates an append-only recovery receipt. Rollback can only remove records listed by that receipt and restore a fast-forwarded current object to its exact previous snapshot. Rollback is blocked after later edits, dependent relations, new operations, changed promotion records or another completed rollback.

## Browser surface

Capture Center adds:

- Project-scoped or unbound Portable Capture export;
- ZIP selection and dry-run conflict report;
- explicit apply action;
- append-only receipt history;
- boundary-checked rollback.

## Database

IndexedDB advances from version 11 to version 12 and adds:

- `capture-recovery-runs`

The store contains immutable import and rollback receipts. Existing Capture stores, Raw Evidence stores and Project State stores are not migrated or rewritten.

## Verification

- full automated suite: 219/219 passed;
- 3,000-object recovery package: 3,000 objects, 3,000 versions, 3,000 operations, 9,000 planned writes;
- package ZIP size: approximately 8.8 MB;
- package validation and dry-run planning: approximately 2.6 seconds in the test environment;
- 1,200-conversation low-memory archive: passed, max concurrent reads 1;
- 3,000-conversation snapshot smoke: passed;
- 3,000-conversation Obsidian smoke: COMPLETE, 0 broken links and 0 invalid Canvas references.

Real Chrome IndexedDB 11 → 12 migration, file download/upload and rollback acceptance remain pending.
