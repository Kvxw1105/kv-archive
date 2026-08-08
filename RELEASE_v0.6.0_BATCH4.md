# ContextVault v0.6.0 — Batch 4

## Local searchable library

This release changes ContextVault from a backup-only extension into a local knowledge library.

### New

- Open the library directly from the extension popup.
- Import ContextVault ZIPs, all split volumes, official OpenAI export ZIPs or `conversations.json`.
- Add the current local backup cache directly to the library.
- Search conversation titles, prose and code.
- Filter by source, Project, role, archive state and date.
- Read active-path and historical-branch messages in one detail view.
- Keep original evidence separate from derived search data.
- Skip duplicates, re-index changed conversations and prevent older exports from rolling the index backward.

### Database migration

The extension database upgrades from v2 to v3. Existing history jobs, conversation artifacts and downloaded assets remain intact. New vault object stores are added alongside the existing stores.

### Privacy

- Imports are processed locally in the extension.
- No search index or conversation evidence is uploaded.
- Clearing the library deletes only the vault stores; it does not delete ChatGPT content or history-backup caches.

### Limitations

- No OCR or PDF/Word content extraction yet.
- ZIP64 and encrypted ZIPs are not accepted.
- Real-browser import performance on the user's full corpus remains deferred.
