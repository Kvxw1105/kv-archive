# TASK-006 — Batch 6 Reviewed Project State

Status: COMPLETED_LOCALLY / REAL_UI_ACCEPTANCE_DEFERRED
Version: 0.8.0
Date: 2026-07-26

## Goal

Allow a local Agent to propose project-state changes without granting it authority to mutate approved state.

## Delivered

- Versioned Project state schema for status, decisions, tasks and supersessions.
- Agent Bundle v2 containing the latest approved Project state as read-only data.
- One controlled Agent tool, `create_state_proposal`, that writes a proposal JSON into a local outbox only.
- Browser State Center for proposal import, evidence validation, conflict detection, Diff review, approval and rejection.
- Immutable approved-state versions, audit events and rollback-as-new-version.
- Optimistic concurrency checks preventing stale review pages from overwriting newer approvals.
- Agent Bundle v1 backward compatibility.

## Invariants

- Conversation evidence is never modified by a state proposal.
- A proposal cannot approve itself.
- Approval is available only inside the local State Center.
- Every proposal must cite one or more evidence URIs present in the local evidence store.
- Rejection and rollback remain auditable.
- Partial updates preserve fields not named by the proposal.

## Verification

- Typecheck: PASS.
- Automated tests: 75/75 PASS.
- Extension build: PASS.
- Agent Bridge build: PASS.
- Packaged CLI and MCP proposal workflows: PASS.

## Deferred

- Real browser UI acceptance on the user's installed extension.
- Real Codex/Claude/Cursor proposal generation against the user's private Bundle.
- Multi-tab concurrency exercise in a real browser; code-level optimistic locking is implemented.
