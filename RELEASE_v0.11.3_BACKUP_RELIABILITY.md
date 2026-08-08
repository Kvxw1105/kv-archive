# KV Archive v0.11.3 — Conversation-first Backup Reliability

v0.11.3 is a focused reliability release for large ChatGPT archives. It corrects a failure mode where an inaccessible or expired attachment URL could pause the entire backup at about 75% and be reported as a global ChatGPT logout even when the user's session remained valid.

## User-facing changes

- Manual full backup now defaults to **conversation-only** storage.
- Attachment metadata and source references are retained by default, but attachment binaries are not downloaded unless the user explicitly selects that option.
- The Backup Center now exposes a separate attachment strategy selector before a run.
- Existing paused jobs can be continued in conversation-only mode without starting the conversation crawl from zero.
- Progress copy now makes clear when conversations are already safely saved and only attachment work remains.

## Reliability changes

- Long-running API requests refresh ChatGPT auth context once after a 401/403 response.
- Signed attachment URLs are renewed once when the binary request returns 401/403.
- A single inaccessible attachment no longer proves that the whole ChatGPT session expired.
- The engine performs a lightweight session probe before classifying a 401/403 as a real logout.
- If the session is still valid, the inaccessible attachment is recorded as failed/skipped and the backup continues.
- Existing-job workspace identity is preserved during resume, even when the live workspace selector cannot rediscover that workspace label.

## Data and compatibility boundaries

- No database schema migration.
- No existing conversation, snapshot, Project, memory, evidence, or attachment record is deleted.
- Existing downloaded attachment binaries remain available.
- Existing jobs remain resumable through the current durable checkpoint and content-addressed object store.
- Historical internal identifiers remain unchanged for compatibility.

## Verification

- `npm test`: 135/135 passed after a clean build.
- TypeScript/core build passed.
- Extension build passed.
- Agent Bridge build passed.
- Changed JavaScript entry points passed `node --check`.

## Remaining acceptance

The live ChatGPT endpoints, account scale, cookies, workspaces, and attachment permissions cannot be reproduced fully in the local test harness. A real Chrome profile test is still required, especially for the user's existing job paused at 75%.
