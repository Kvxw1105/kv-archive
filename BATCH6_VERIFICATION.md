# ContextVault Batch 6 Verification

Version: 0.8.0
Date: 2026-07-26
Status: COMPLETED_LOCALLY / REAL_UI_ACCEPTANCE_DEFERRED

## Scope verified

- Project status, decision, task and supersession proposal schemas.
- Approved Project state embedded read-only in Agent Bundle v2.
- Agent Bundle v1 backward compatibility.
- Seven read-only MCP evidence/state tools.
- One non-destructive proposal-outbox tool.
- Direct CLI proposal generation.
- Evidence URI validation.
- Before/after Diff generation.
- Proposal conflict detection against base version/hash and touched records.
- Approval, rejection, immutable versions, audit events and rollback-as-new-version.
- Partial-update field preservation.
- Optimistic locking for approval and rollback.
- IndexedDB schema v4 build and State Center assets.

## Commands

```text
npm run typecheck
npm test
```

Results:

```text
TypeScript: PASS
Tests: 75
Pass: 75
Fail: 0
```

The test suite includes:

- proposal application for all four proposal kinds;
- valid and invalid evidence references;
- stale-bundle conflicts and unrelated-record allowance;
- approval/rejection/version/audit/rollback lifecycle;
- partial status, task and decision updates;
- empty-change and enum validation;
- Agent Bundle v1 compatibility;
- MCP tool-permission boundary;
- CLI proposal output with no copied raw evidence or credential fields;
- child-process MCP stdio smoke tests;
- all Batch 0–5 regressions.

## Build outputs

```text
npm run build:core      PASS
npm run build:extension PASS
npm run build:agent     PASS
```

Built extension version: `0.8.0`.

The built extension contains:

```text
state.html
state.css
state.js
state-governance.js
library-store.js
agent-bundle.js
```

The standalone Agent Bridge contains:

```text
dist/agent/agent-core.js
dist/agent/mcp-server.js
dist/agent/proposal-core.js
dist/agent/state-governance.js
dist/agent/index.js
```

## Permission evidence

MCP `tools/list` returns eight tools:

- seven with `readOnlyHint=true` and `destructiveHint=false`;
- `create_state_proposal` with `destructiveHint=false` and no direct-state mutation capability.

A call to a nonexistent approval tool returns JSON-RPC method-not-found. Generated proposal results explicitly report:

```json
{
  "approvalRequired": true,
  "approvedStateMutated": false
}
```

## Deferred acceptance

Not claimed as verified:

- browser migration and State Center interaction in the user's installed profile;
- real Codex/Claude/Cursor proposal generation;
- real multi-tab concurrency exercise;
- previously deferred ChatGPT asset and full-corpus performance checks.

## Completion calibration

- Code implementation: COMPLETED.
- Local typecheck/build/test: COMPLETED.
- Packaged-artifact smoke: recorded during final packaging.
- Git commit/push/PR/CI/public release: NOT PERFORMED.

## Final packaged-artifact smoke

The final extension and Agent Bridge ZIP files were extracted into clean directories before execution.

Observed results:

```text
extension manifest: 0.8.0
built JavaScript syntax: PASS
Agent Bundle v2 inspect: PASS
Context Pack CLI: 199 estimated tokens, 1 cited source, not truncated
proposal CLI: PASS
MCP protocol: 2025-06-18
MCP tools: 8
read-only tools: 7
controlled proposal tools: 1
approvalRequired: true
approvedStateMutated: false
proposal import: pending
proposal conflicts: 0
proposal approval: new state v1
approved Diff: status.phase and status.progressPercent only
```

System `unzip -t` passed for:

- extension release ZIP;
- standalone Agent Bridge ZIP;
- complete source ZIP;
- synthetic Agent Bundle v2.

Release evidence files include:

- `PACKAGED_MCP_BATCH6_SMOKE.json`;
- `PACKAGED_REVIEW_BATCH6_SMOKE.json`;
- `SAMPLE_STATE_PROPOSAL.json`;
- `SAMPLE_CONTEXT_PACK_BATCH6.md`.
