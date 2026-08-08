# ContextVault Batch 2 Verification

Version: `0.4.0-batch2`
Date: 2026-07-26
Status: `COMPLETED LOCALLY / REAL ACCOUNT ACCEPTANCE PENDING`

## Verified scope

Batch 2 unifies regular conversations, archived conversations and Projects into one recoverable history job.

Verified behaviors:

- regular conversation offset pagination;
- archived conversation offset pagination using `is_archived=true`;
- Project catalog cursor pagination;
- per-Project conversation cursor pagination;
- source-aware metadata and ZIP paths;
- Batch 1 job migration without re-fetching verified regular conversations;
- pause/resume and failed-item-only retry;
- account/workspace mismatch rejection;
- temporary auth context held in runtime memory only;
- incremental refresh of new and updated conversations;
- source membership reconciliation after a conversation moves from regular to archived;
- single ZIP with `index.html`, `manifest.json`, `projects.json` and per-conversation evidence.

## Commands executed

```text
npm run typecheck
npm test
find apps/extension/dist -name '*.js' -print0 | xargs -0 -n1 node --check
python3 -m json.tool apps/extension/dist/manifest.json
npm run mvp
unzip -t .tmp/batch2/full-backup.zip
unzip -l .tmp/batch2/full-backup.zip
```

## Results

- TypeScript typecheck: passed.
- Automated tests: 28 / 28 passed.
- Core build: passed.
- Extension build: passed.
- Built JavaScript syntax checks: passed.
- Manifest JSON parse: passed.
- Popup and backup HTML duplicate-ID / local-resource reference checks: passed.
- CLI regression smoke test: passed.
- Synthetic full-backup manifest counts:
  - regular: 1;
  - archived: 1;
  - Projects: 1;
  - Project conversations: 1;
  - exported conversations: 3.
- System ZIP integrity check: passed with 22 files and no compressed-data errors.

## Security checks

The source tree was searched for access-token persistence paths.

Observed token usage is limited to:

- extracting the temporary `accessToken` from `/api/auth/session`;
- adding an in-memory `Authorization` header to same-origin requests;
- returning only a boolean `authenticated` flag to the UI-facing context.

No token is written to IndexedDB, `chrome.storage`, logs, manifest, archive manifest or conversation ZIP files.

The unused `storage` permission was removed from the Manifest V3 permission list.

## Not verified in this environment

- a real logged-in account containing archived conversations;
- a real Team workspace with multiple Projects;
- a Project requiring more than one real cursor page;
- every possible `/api/auth/session` account schema variant;
- a text-only archive near the 450 MB safety threshold;
- browser UI behavior under a live login session.

These remain user-side acceptance items and are not represented as completed.

## Release package QA

- `context-vault-extension-v0.4.0-batch2.zip`: system unzip test passed.
- `context-vault-source-v0.4.0-batch2.zip`: system unzip test passed.
- SHA-256 values are published in `context-vault-v0.4.0-checksums.txt`.
