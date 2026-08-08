# KV Archive v0.14.1 — Memory Gate Review & Benchmark

v0.14.1 completes the local Memory Gate review loop started in v0.14.0. It adds a browser-side review table, persistent policy configuration, immutable run receipts, rollback-safe policy restoration, optional Project State governance metadata, and a paired Continuity Benchmark experiment for Gate-off versus Gate-on evaluation.

## User-visible changes

- Memory Center now shows every Memory Candidate with INCLUDE / EXCLUDE / REVIEW, reason codes, warnings, evidence count and Token allocation.
- Users can choose safe, balanced or broad policy, internal or external target, and a Gate Token budget.
- Every Gate run is stored locally as an immutable receipt tied to Project State version/hash and the exact policy config.
- A previous run can restore its policy as a new config version; the old receipt is never rewritten.
- Gate receipts export as a ZIP containing manifest, report, separated result sets and config snapshot.

## Governance compatibility

Project State schemaVersion remains 1. Decision and task records may now carry optional fields:

- sensitivity: public / internal / restricted;
- expiresAt;
- conflictsWith;
- locked;
- importance;
- scope.

Older records normalize safely. Invalid explicit expiry metadata requires REVIEW instead of being silently ignored.

## Paired Continuity Benchmark

The Agent Bridge adds:

- `benchmark-gate-create`: creates equal-budget Gate-off and Gate-on Context Packs, one public challenge, one private answer key, two response templates and run instructions.
- `benchmark-gate-score`: scores both responses against the same answer key and reports score delta, verdict changes, dimension deltas and failure taxonomy.

The comparison only evaluates the supplied receiving-Agent responses. It does not claim that Memory Gate universally improves every model or task.

## Safety and compatibility

- Approved Project State is never mutated by running Gate.
- Raw Evidence, Evidence URIs, approved Memory versions and Context Pack behavior without an explicit Gate remain unchanged.
- No model or network call is required.
- Existing Voice/Live, long-conversation, Basket, scheduled backup, Agent Bridge and Obsidian functionality remains included.

## Status

Code and automated/performance verification are complete locally. Real browser UI acceptance, real Agent Bundle Gate use and a real paired receiving-Agent benchmark remain pending.
