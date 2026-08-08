# Batch 8A.1 — Obsidian Attachment Materialization Plan

Status: COMPLETED LOCALLY
Target version: 0.11.1
Date: 2026-07-26

## Problem

v0.11.0 could represent Asset nodes and relationships in `KnowledgeGraphIR`, but did not write locally downloaded attachment binaries into the exported Obsidian Vault. This left a gap between graph structure and a self-contained offline Vault.

## User-visible target

When the user selects **Include locally downloaded attachments** for a Project export:

- locally available Project/conversation attachments are listed during analysis without reading their binary payloads;
- the export plan includes their size and stable managed path;
- each binary is loaded only when its output volume is generated;
- the file is written under `90 Attachments/`;
- generated Markdown links resolve to the materialized file;
- missing or not-yet-downloaded assets are reported and do not trigger network requests;
- skipping binaries remains available and preserves v0.11.0 behavior.

## Non-goals

- no network re-download during Obsidian export;
- no direct write into an existing user Vault;
- no bidirectional Obsidian synchronization;
- no user-authored file overwrite;
- no arbitrary external file-system crawl.

## Design decision

Reuse the existing content-addressed attachment store. The preview path reads metadata only. Volume generation resolves one content object at a time, verifies its object key/hash, writes it to the current ZIP, and releases the payload. The canonical evidence schema remains unchanged.

## Implementation slices

1. Extend the provider-neutral graph/export contract with an optional set of materialized Asset node IDs.
2. Allocate deterministic, extension-preserving paths under `90 Attachments/`.
3. Match Project and conversation assets from the latest local backup job.
4. Add include/skip controls and attachment quality metrics to the export center.
5. Add asset descriptors to the low-memory volume plan.
6. Resolve and verify one binary at volume-build time.
7. Add integration, ZIP-content, regression and pressure tests.

## Acceptance

- binary preview reads: 0;
- concurrent binary payload reads: at most 1;
- materialized attachment exists in final ZIP with exact bytes;
- broken generated links: 0;
- missing local binaries are reported, not silently omitted;
- complete automated suite passes;
- prior 1,200-conversation and 3,000-conversation pressure paths remain passing.

## Rollback

Set attachment mode to `skip`, or revert the v0.11.1 exporter/UI changes. No database migration or existing evidence mutation is required.
