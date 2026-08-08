# Batch 8A.1 Verification — Obsidian Attachment Materialization

Version: 0.11.1
Date: 2026-07-26
Engineering state: LOCALLY_VERIFIED

## Scope

This verification covers attachment discovery, metadata-only analysis, stable Asset paths, deferred content-object reads, binary integrity checks, ZIP materialization, UI wiring, sample Vault output and regressions.

## Results

- TypeScript/core build: passed.
- Targeted knowledge-export and Obsidian tests: 15/15 passed.
- Full automated suite: 128/128 passed.
- Obsidian 3,000-conversation pressure test: passed.
- Existing 1,200-conversation low-memory full-backup pressure test: passed.
- Sample Vault generation: passed.
- Sample binary entry: `90 Attachments/Lab Runner Diagram__955b77a2.png`, 68 bytes.
- Broken wiki links in pressure run: 0.
- Invalid Canvas file references: 0.

## Low-memory evidence

The analysis path reads asset metadata only. Binary data is requested only while building the volume that owns the asset. The targeted integration test observed zero payload reads during preview and one payload read during ZIP generation.

The existing large-corpus regression remains bounded to one full conversation read concurrently. Attachment payload processing follows the same one-at-a-time discipline.

## 3,000-conversation Obsidian pressure result

- conversations: 3,000;
- nodes: 3,002;
- edges: 6,001;
- ZIP volumes: 2;
- total output: 17,371,873 bytes;
- maximum volume: 13,159,499 bytes;
- maximum concurrent full-conversation reads: 1;
- broken links: 0;
- invalid Canvas references: 0.

## Remaining external acceptance

The current container does not provide the user's real Obsidian application or real ChatGPT signed-asset endpoints. The following remain pending:

- open a real exported Project Vault in Obsidian;
- verify image/document rendering and click-through;
- verify Graph View, Backlinks, Properties and Canvas;
- verify missing-asset reporting against the user's real backup;
- repeat export after title and attachment changes.

## Seven-level status

- EDITED: yes.
- LOCALLY_VERIFIED: yes.
- COMMITTED: no.
- PUSHED: no.
- PR_UPDATED: no.
- CI_PASSED: no.
- RELEASED: no; an installable local package is produced, but it has not been deployed to the user's browser or a store.

## Final archive verification

- final extension ZIP unpacked successfully;
- unpacked Manifest version is 0.11.1;
- every packaged JavaScript file passed `node --check`;
- popup entry opens `knowledge.html`;
- final sample Vault unpacked successfully and contains a valid 68-byte PNG under `90 Attachments/`;
- final source ZIP unpacked successfully;
- `npm test` rerun from the unpacked source ZIP: 128/128 passed.
