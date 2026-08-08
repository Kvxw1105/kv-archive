# TASK-013 — Large Backup and Attachment Reliability

Status: COMPLETED_LOCALLY_VERIFIED_REAL_ACCOUNT_ACCEPTANCE_PENDING
Version target: 0.11.3
Mode: DEBUG + IMPLEMENT + REVIEW

## Observed defect

A large real account paused at 75% with a global “ChatGPT login expired” message. Code inspection showed that 75% begins the attachment-download phase, manual runs defaulted to downloading every attachment, and any attachment 401/403 paused the entire job as if the account session had expired.

## Observable target

- Conversation backup is the default and can complete without attachment binaries.
- Attachment download is an explicit option.
- A stale auth context or signed attachment URL receives one bounded refresh attempt.
- A single inaccessible attachment does not stop or invalidate the conversation archive.
- A real expired session still pauses safely.
- Existing durable progress, local objects, snapshots, and user data remain intact.

## Protected behavior

- No database migration or destructive cleanup.
- Preserve existing job and account/workspace ownership.
- Preserve content-addressed conversation and attachment objects.
- Preserve scheduled-backup attachment policy.
- Preserve archive, library, state, memory, Agent, and Obsidian behavior.

## Implementation

- Default manual/engine attachment policy changed to `references-only`.
- Added manual attachment strategy UI.
- Added auth-context retry, session verification, and signed-URL renewal.
- Attachment 401/403 is classified using a separate session probe.
- Resume uses the job's locked workspace context.
- Added regression tests for default policy and auth/attachment separation.

## Verification

- `npm test`: 135/135 passed.
- Clean core, extension, and Agent builds passed.
- Changed JavaScript files passed syntax checks.
- Real loaded-extension/account acceptance remains pending.

## Git state

This extracted delivery source is not a Git worktree. No commit, push, PR, CI, or release action was performed.
