# Release v0.5.0 — Batch 3 Assets

ContextVault now backs up the binary assets attached to ChatGPT conversations and Projects, rather than preserving only their text references.

## Added

- User-uploaded images and documents.
- DALL-E and generated-image file pointers.
- Downloadable code/tool output files.
- Project-level files.
- Global `fileId` deduplication across conversations and Projects.
- Resumable binary storage and failed-file-only retry.
- Expected byte-size validation and SHA-256 recording.
- Per-conversation `asset-manifest.json`.
- Per-Project `project-assets.json`.
- Root `asset-integrity-report.json`.
- Readable local links from HTML and Markdown to files in `assets/`.
- Automatic numbered ZIP volumes for large backups.
- In-place v0.4.0 database and task migration.

## Explicit boundaries

- A single file is limited to 64 MB in the current browser-only transport.
- Sandbox-only references without a recoverable ChatGPT `fileId` remain visible as unsupported evidence.
- Failed and unsupported assets make the asset report `PARTIAL`; they are never silently counted as complete.
- Real logged-in endpoint variants still require user-browser acceptance.
