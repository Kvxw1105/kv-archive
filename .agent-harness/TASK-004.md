# TASK-004 — Local Searchable Vault and Official Export Import

Status: COMPLETED LOCALLY / REAL BROWSER IMPORT ACCEPTANCE DEFERRED BY USER

## Goal

Turn ContextVault backups and official OpenAI data exports into a durable, local-first searchable evidence library.

## Implemented

- IndexedDB schema v3 with separate stores for imports, conversations, immutable evidence versions, derived messages and token postings.
- ContextVault ZIP and multi-volume import.
- Multiple independent ContextVault ZIPs in one selection.
- Official OpenAI `conversations.json`, direct JSON and numbered conversation JSON import.
- Stored and deflate ZIP decompression with CRC, path traversal, entry-count and uncompressed-size checks.
- Full-graph message indexing, including non-active historical branches.
- Chinese character, bigram and trigram tokenization plus Latin tokenization.
- Search filters for source, Project, role, archive state and date.
- Conversation detail viewer with active-path and historical-branch distinction.
- Duplicate prevention, changed-record re-indexing and stale-import non-regression.
- Evidence/derived-data separation.
- Direct indexing from the existing local backup cache without download/re-import.
- Library clearing that does not touch ChatGPT or the history-backup cache.

## Verification

- 56 automated tests passed.
- TypeScript typecheck and both builds passed.
- Built JavaScript syntax and HTML ID checks passed.
- ZIP security and official numbered-export regressions passed.
- Real Chromium execution was attempted but blocked by the managed container policy for localhost and file URLs.

## Deferred acceptance

- Import a real ContextVault multi-volume backup in the user's installed extension.
- Import a real official OpenAI export containing numbered files and assets.
- Measure indexing latency and browser quota on a large personal corpus.
