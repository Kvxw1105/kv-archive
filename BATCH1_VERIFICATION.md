# ContextVault v0.3.0 Batch 1 Verification

Date: 2026-07-26

## Verified locally

### Build and type safety

- `npm run typecheck` — passed.
- `npm run build` — passed.
- Extension Manifest parsed successfully as version `0.3.0`.
- All built extension JavaScript files passed `node --check`.

### Automated behavior tests

- `npm test` — 22/22 passed.
- Existing current-conversation capture parser tests passed.
- Canonical graph, branch preservation and integrity tests passed.
- History list response shape normalization passed.
- Pagination and ID deduplication passed.
- Pause/resume and completed-ID skipping passed.
- Failed-item-only retry passed.
- Transient retry/backoff passed.
- Login-expiry pause behavior passed.
- Single history ZIP construction passed.

### Integration checks

A two-conversation synthetic history archive was generated and checked with system `unzip`:

- archive opened successfully;
- central directory valid;
- `index.html` present;
- 2 conversation directories present;
- each directory contains HTML, Markdown, raw JSON, canonical JSON and integrity report;
- no ZIP errors detected.

### CLI regression

The existing CLI fixture flow was rerun successfully and generated:

- `raw.json`;
- `canonical.json`;
- `conversation.md`;
- `integrity-report.json`.

## Not verified in this environment

- Logged-in ChatGPT history endpoint against the user's real account.
- Very large real history archives near the 450 MB safety boundary.
- Chrome service behavior under user-specific enterprise policies.
- Projects, archived conversations and binary attachments, which are intentionally outside Batch 1.

## Completion calibration

Batch 1 code and deterministic verification are complete. Real-account acceptance remains required before calling the browser path production-proven.
