# ContextVault v0.5.1 — Batch 3 Real-Account Acceptance Candidate

This patch does not begin Batch 4. It closes the tooling gap required to verify Batch 3 against a real logged-in ChatGPT account.

## Changes

- adds one-click privacy-safe acceptance diagnostic HTML;
- records which compatible signed-file endpoint succeeded;
- records HTTP status and download host without storing signed URLs;
- classifies failures as auth, endpoint/file missing, rate limit, file too large, upstream server, integrity/shape, sandbox-only or other;
- aliases conversation, Project and asset identifiers;
- excludes conversation content, original titles, original filenames, tokens, cookies and signed URLs from the diagnostic;
- removes the previous `sourceUrl` field from newly stored assets;
- lazily purges obsolete sensitive transport fields from existing IndexedDB asset rows when they are read;
- preserves v0.5.0 conversation and asset progress in place.

## Gate

Batch 3 may move to `REAL_ACCOUNT_ACCEPTED` only when:

1. a real-account run finishes or finishes with explicitly understood unsupported references;
2. every discovered downloadable asset is saved or has a reproduced, classified defect;
3. saved byte counts and hashes are present;
4. the diagnostic contains no credentials or signed URLs;
5. at least the available representative asset kinds have been exercised;
6. all reproduced compatibility defects are fixed and rerun.

Missing recommended asset kinds are marked as unexercised coverage, not silently treated as passed.
