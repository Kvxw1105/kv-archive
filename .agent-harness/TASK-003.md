# TASK-003 — Projects and Archived Conversations

Status: COMPLETED LOCALLY / REAL ACCOUNT ACCEPTANCE PENDING

## Goal

Extend the recoverable history task into one source-aware backup covering regular conversations, archived conversations and Projects without repeating verified Batch 1 artifacts.

## Implemented

- History job schema v2.
- In-place Batch 1 migration using the same IndexedDB job and artifact keys.
- Independent regular and archived offset pagination.
- Project catalog cursor pagination.
- Per-project conversation cursor pagination.
- Temporary auth context, workspace discovery and user selection.
- Workspace-mixing guard.
- Incremental new/updated conversation refresh.
- Source-membership reconciliation after regular/archive moves.
- Source-aware ZIP folders, `projects.json`, manifest counts and index filters.

## Verification

- 28 automated tests passed before final package QA.
- Typecheck and build passed.
- Final built-JavaScript, manifest and system-unzip checks are recorded in `BATCH2_VERIFICATION.md`.

## Remaining acceptance

- Run against a real account containing archived conversations.
- Run against a Team workspace containing at least one Project with multiple cursor pages.
- Compare UI counts with the archive manifest and index.
