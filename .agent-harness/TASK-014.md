# TASK-014 — Readable Export, Link Fidelity, Obsidian Agent Handoff, and GUI Simplification

Status: LOCALLY_VERIFIED_REAL_ACCEPTANCE_PENDING
Version target: 0.12.0
Mode: FULL_LOOP

## Observed user problems

1. Readable HTML exposes empty internal nodes, tool calls, tool results, reasoning summaries, and unsupported-event placeholders as if they were normal conversation content.
2. Current conversation exports do not reliably preserve user-visible file/download links and source fallbacks.
3. Obsidian ZIP delivery stops at file generation; new users must understand Vaults, extraction, merging, and existing-Vault placement themselves.
4. Full-page controls expose too many equal-priority settings and actions at once.
5. Agent/search layers may ingest internal technical events that are not needed for task continuation.

## Observable target

- Default HTML and Markdown exports show human-readable conversation content and user-visible artifacts only.
- Raw evidence and technical events remain available in backup ZIP evidence files and an explicit technical export.
- File, citation, and generated-artifact links remain clickable when a usable URL exists; source-conversation fallback remains visible.
- Agent/library indexing excludes tool calls, raw tool results, reasoning summaries, and unsupported internal nodes by default.
- Obsidian exports contain human instructions, machine manifest, Agent handoff prompt, safe import rules, and a rollback receipt template.
- Obsidian UI can copy a ready-to-paste local-Agent instruction after preview.
- Backup and Obsidian pages keep all existing controls but move infrequent controls into progressive-disclosure sections.

## Protected behavior

- Preserve raw JSON, canonical JSON, integrity reports, database evidence, attachment inventory, snapshot semantics, and stable managed node paths.
- Do not delete unknown source payloads.
- Do not modify authentication, workspace ownership, backup resume, or database data destructively.
- Keep one downloadable artifact per popup export action.
- Keep current v0.11.3 reliability behavior.

## Verification

- Typecheck and full automated suite.
- New tests for readable filtering, technical evidence mode, link cards, Agent indexing filters, Obsidian handoff files, import manifest, GUI disclosure, and version identity.
- Extension build and archive integrity.
- Real loaded-extension and real Obsidian acceptance remain separate.

## Completion evidence

- Full clean build and test suite: 141/141 passed.
- Obsidian 3,000-conversation smoke: COMPLETE, 0 broken links, 0 invalid Canvas references.
- Archive 1,200-conversation smoke: 29 bounded volumes, sequential reads.
- Release and real-environment acceptance documents created.
- Installation and source archives still require final packaging and checksum validation before delivery.
