# Batch 6 Real Environment Acceptance

Version: 0.8.0
Status: DEFERRED BY USER

Use this checklist when manual validation is resumed.

## Extension migration

- Upgrade the same unpacked extension directory from v0.7.0 to v0.8.0.
- Confirm existing backup and library records remain present.
- Open Project State Center and confirm known Projects appear.

## Agent proposal

- Export a new Agent Bundle v2 for one Project.
- Register the packaged Agent Bridge in a real MCP host.
- Ask the Agent to cite evidence and call `create_state_proposal`.
- Confirm a single JSON file appears in the configured proposal outbox.
- Confirm no approved state changes before import and approval.

## Review

- Import the proposal JSON in the State Center.
- Confirm cited evidence is accepted only when present locally.
- Confirm the Diff matches the requested fields.
- Approve and confirm a new version is created.
- Reject another proposal and confirm approved state remains unchanged.

## Conflict

- Export Bundle A.
- Approve a touching state change in ContextVault.
- Generate a second touching proposal from stale Bundle A.
- Confirm it is marked conflicted and cannot be approved.
- Generate an unrelated stale proposal and confirm it may remain approvable when its touched records did not change.

## Rollback

- Roll back to an earlier approved version.
- Confirm a new version is created rather than deleting later history.
- Confirm the audit log records the source version, new version and reviewer reason.

## Privacy

Open a proposal JSON and verify that it contains evidence URIs but not:

- raw conversation bodies;
- Access Tokens, cookies or Authorization headers;
- signed attachment URLs;
- binary attachments.
