# ContextVault v0.8.0 — Batch 6

## Added

- Local Project State Center.
- Approved state schema for project status, decisions, tasks and supersessions.
- Agent Bundle v2 with the current approved Project state.
- `create_state_proposal` MCP/CLI output tool.
- Proposal JSON outbox with no direct approval authority.
- Evidence validation against retained local conversation evidence.
- Before/after state Diff and proposal impact review.
- Stale-bundle and concurrent-change conflict detection.
- Explicit local approval and rejection.
- Immutable state versions and audit events.
- Rollback by creating a new approved version.
- Agent Bundle v1 backward compatibility.

## Safety corrections during review

- Partial status updates no longer clear unspecified status fields.
- Partial task/decision updates preserve existing title, notes, owner, consequences and other untouched fields.
- Empty partial changes and invalid enum values are rejected.
- Approval and rollback use optimistic locking to prevent stale tabs from overwriting a newer action.
- Proposal files contain proposal metadata and evidence URIs, not copied raw conversation evidence or credentials.

## Permission boundary

The Agent Bridge exposes seven read-only tools and one controlled file-output tool. It exposes no method to approve, reject, rollback, delete or directly replace approved state.

## Compatibility

- Agent Bundle v2 is produced by v0.8.0.
- Agent Bundle v1 remains readable for Batch 5 search and Context Pack workflows, but it has no approved Project state and therefore cannot create a state proposal until a v2 Bundle is exported.
- Existing IndexedDB data migrates from schema version 3 to 4.
