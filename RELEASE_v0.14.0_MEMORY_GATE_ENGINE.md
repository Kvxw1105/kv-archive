# KV Archive v0.14.0 · Memory Gate Engine

This release candidate implements the first complete Memory Gate vertical slice for Agent handoff.

## Delivered

- deterministic Project State to Memory Candidate conversion;
- INCLUDE / EXCLUDE / REVIEW decisions with reason codes;
- safe, balanced and broad policies;
- project scope, supersession, inactive status, expiry, sensitivity, conflict and evidence checks;
- deterministic token allocation with locked-memory overrun reporting;
- `memory-gate` Agent CLI command;
- `run_memory_gate` MCP tool;
- optional gated memory in Context Packs;
- complete report file set;
- root-derived Agent Bridge version to prevent version drift.

## Not yet delivered

- extension Memory Center review UI;
- persistent candidate governance overrides;
- Gate policy receipts and rollback history;
- real Agent Bundle acceptance and Continuity Benchmark comparison.
