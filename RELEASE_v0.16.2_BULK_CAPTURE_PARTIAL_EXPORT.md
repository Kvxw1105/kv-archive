# KV Archive v0.16.2 — Bulk Capture Control & Partial Export

## Product correction

Large selected-conversation work is no longer presented as one opaque “export” transaction. The user-visible workflow is now:

1. capture conversations into durable browser-local storage;
2. pause or resume capture at a safe boundary;
3. export any currently saved subset to local ZIP files;
4. continue the same capture task later.

## Delivered

- explicit Capture and Local Export stages;
- pause, resume, pause-and-export and new-batch actions;
- saved, remaining and failed counters;
- read-only partial export snapshots based on actual stored artifacts;
- partial archive progress metadata and filenames;
- crash/stale-checkpoint reconciliation from IndexedDB artifacts;
- 60-second conversation request timeout covering response body parsing;
- two-attempt ceiling for selected batches;
- pause-aware retry cancellation;
- failed-conversation isolation so one bad item does not block the batch;
- chunked catalog rendering and bounded selected-item preview.

## Safety model

“Saved” means the conversation artifact is already committed to browser IndexedDB. Pausing does not delete it. Export reads those durable artifacts and does not consume, complete or rewrite the resumable capture job. A partial ZIP is explicitly labeled and records the source task’s total, saved, remaining and failed counts.

## Compatibility

- Existing v0.16.1 selections, catalogs and durable history jobs remain readable.
- No IndexedDB schema migration is introduced in v0.16.2.
- Existing complete archives and archive readers remain compatible; new progress metadata is additive.
- Raw Evidence, Project State, Memory and Portable Capture contracts are unchanged.
