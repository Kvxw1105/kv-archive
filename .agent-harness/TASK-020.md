# TASK-020 · Memory Gate Engine Slice

Status: `LOCALLY_VERIFIED`

## Goal

Produce a deterministic, evidence-aware gate between approved Project State and Agent Context Packs.

## Completed

- candidate contract and Project State conversion;
- INCLUDE / EXCLUDE / REVIEW engine;
- safe / balanced / broad policy;
- scope, supersession, inactive, expiry, sensitivity, conflict, evidence and budget rules;
- CLI and MCP interfaces;
- Context Pack integration;
- deterministic reports and tests;
- Agent Bridge version drift fix.

## Protected contracts

- approved Project State remains read-only;
- Raw Evidence and Evidence URIs are unchanged;
- legacy Agent Bundle v1/v2 remains readable;
- Context Pack without `memoryGatePolicy` preserves prior behavior;
- no external network or model call is required.

## Remaining

- extension review UI;
- optional governance metadata persistence;
- Gate receipts and policy history;
- benchmark comparison;
- real Agent Bundle acceptance.
