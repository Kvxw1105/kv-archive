# ContextVault Batch 3 Verification

Version: 0.5.0
Date: 2026-07-26
Status: locally verified; real-account asset acceptance pending

## Implemented

- Recursive asset reference extraction from message content and metadata.
- Project file catalog extraction.
- User uploads, images, DALL-E pointers, tool/code output references and Project-level files.
- Global deduplication by file ID while preserving every conversation and Project reference.
- Resumable IndexedDB binary asset storage with Batch 2 in-place migration.
- Signed URL compatibility fallbacks and chunked page-to-extension binary transfer.
- Per-file 64 MB safety boundary.
- Expected-size validation and SHA-256 recording.
- Missing, failed, unsupported and duplicate-reference reporting.
- Failed-asset-only retry without re-fetching completed conversations.
- Stale cached asset exclusion during incremental backup.
- Local attachment links in readable HTML and Markdown.
- Per-conversation, per-Project and root asset manifests.
- Deterministic numbered ZIP volumes for large backups.

## Automated evidence

```text
npm run typecheck    PASS
npm test             PASS — 40/40
npm run mvp          PASS
extension build      PASS
manifest parse       PASS — 0.5.0
built JS syntax      PASS
```

## Archive evidence

A synthetic backup was generated with:

- one regular conversation;
- one Project conversation;
- one image referenced by both conversations and the Project catalog;
- one PDF attachment;
- Chinese conversation, Project and asset filenames;
- a deliberately low volume threshold.

Results:

```text
volumes                 3
ZIP integrity           PASS for every volume
combined extraction     PASS
asset report            COMPLETE
unique assets           2
saved binaries          2
expected bytes          1,350,000
actual bytes            1,350,000
duplicate references    2
index.html               present
asset report             present
Unicode paths            preserved
```

The shared image exists only once under `assets/`, while both conversations retain links to the same stored binary.

## Security review

- Access tokens are obtained only for the active run.
- The job context persisted to IndexedDB excludes access tokens and cookies.
- Authorization values are not written to logs, manifests or ZIP files.
- Cached assets no longer present in the current inventory are excluded from the archive.

## UI review

The built backup center HTML/CSS was inspected for the new ten-metric layout, responsive three-column/two-column states, asset progress, failure counts and volume explanation. Automated Chromium screenshot capture could not complete in this container because its headless browser process did not terminate; this is recorded as an environment limitation rather than a passed browser visual test.

## Remaining real-world verification

The container has no authenticated ChatGPT account. Real signed URLs, DALL-E images, user documents, code-interpreter outputs and Project files must be tested in the user's browser. These paths are implemented and covered with deterministic fixtures, but are not claimed as real-account verified.
