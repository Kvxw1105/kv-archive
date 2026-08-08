# KV Archive v0.16.11 — Incremental Conversation Node Dedup & Scheduler UI Recovery

Status: `LOCALLY_VERIFIED`  
Date: `2026-08-08`

## Why this node exists

A real Backup Center screenshot exposed a scheduler status-rendering crash: `Cannot set properties of undefined (setting 'textContent')`. At the same time, continued conversations still created another complete raw Conversation content object whenever a previously archived ChatGPT thread received new messages.

## Scheduler UI recovery

The 10-minute acceptance elements existed in `backup.html` but four IDs were missing from the `backup.js` element registry. v0.16.11 registers the countdown/progress elements and adds a defensive render guard. A regression test requires every rendered scheduler-test element to be registered.

## Conversation storage v2

For ChatGPT payloads containing a plain-object `mapping`, History Store now persists:

1. immutable `conversation-node` objects, one per raw mapping node;
2. fixed-size `conversation-map-chunk` objects containing ordered `[nodeId, nodeObjectKey]` references;
3. one `conversation-manifest/v2` preserving all non-mapping top-level raw fields plus ordered reference-chunk keys.

`getArtifact()` reconstructs the exact raw shape before existing exporters/renderers see it. Provider payloads without a compatible `mapping` retain the legacy whole-conversation fallback.

## Continued-conversation behavior

When a conversation already uses v2 storage and gains one user/assistant turn, most historical node object keys remain unchanged. The previous leaf usually changes once because its `children` array gains the new user node. Therefore the typical physical delta is:

- one changed previous-leaf node;
- two newly appended nodes;
- one changed/new tail mapping-reference chunk;
- one new small manifest.

A 10,000-node performance fixture that appended two nodes reused 9,999 prior node objects (99.99%) and required only 3 node objects + 1 mapping chunk + 1 manifest. The latest local planning smoke completed in 395 ms for the initial graph and 331 ms for the updated graph at about 132 MB RSS.

## Backward compatibility

There is no eager rewrite of v0.16.10 data. Existing whole-conversation content objects and logical snapshots remain readable. The first time a legacy conversation changes after upgrade, the latest state seeds v2 node/chunk objects; reuse becomes visible on subsequent changes.

No IndexedDB version bump, Evidence URI change, Agent Bundle schema change, Portable Capture schema change or destructive migration was introduced.

## Snapshot retention and GC

Logical snapshots continue to reference the History artifact's top-level object key. Garbage collection now expands content-object `references` transitively, preserving manifest → mapping chunk → node dependencies for every current artifact and retained snapshot.

## Reuse observability

The incremental job tracks inserted/reused object counts and approximate payload bytes. Scheduled snapshot status now shows `本轮复用节省` and can report reused conversation-node count/bytes. This is a per-cycle payload-write estimate, not a lifetime disk-usage audit.

## Remaining boundary

The optimization reduces physical storage writes. KV Archive still fetches and hashes the latest raw graph for a conversation already identified as changed. Real Chrome owner-profile scheduling, IndexedDB lifecycle and upstream history behavior require external acceptance.
