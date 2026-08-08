# ContextVault Batch 4 Verification

Version: 0.6.0
Date: 2026-07-26
Status: COMPLETED LOCALLY / REAL BROWSER ACCEPTANCE DEFERRED

## Delivered behavior

Batch 4 adds an extension-hosted local evidence library. The library imports ContextVault backups and official OpenAI exports, stores immutable evidence separately from derived indexes, and supports full-text retrieval across active and historical conversation branches.

### Import formats

- ContextVault single ZIP.
- All ContextVault volume ZIPs selected together.
- Multiple independent ContextVault ZIPs selected together.
- OpenAI official export ZIP with `conversations.json`.
- OpenAI official export ZIP with numbered conversation JSON files.
- Direct `conversations.json`.

### Database stores

- `vault-imports`: import audit records.
- `vault-conversations`: current searchable conversation state.
- `vault-evidence`: immutable raw + canonical evidence versions.
- `vault-messages`: derived searchable message documents.
- `vault-postings`: derived token-to-message postings.

History backup stores remain separate and are not deleted when the library is cleared.

### Search and UI

- Search title, text and code.
- Index all graph branches, not only the active path.
- Filter by source, Project, role, archive state and date range.
- Open a conversation detail view and distinguish active-path messages from historical branches.
- Add existing local backup cache directly to the library.

### Incremental behavior

- Identical evidence is skipped.
- Changed evidence replaces only that conversation's derived index.
- Previous evidence versions remain retained.
- An older import cannot roll the current searchable version backward.
- Source provenance is merged across imports.

## Verification commands

```text
npm run typecheck
npm test
npm run build
node --check apps/extension/dist/*.js
```

## Results

```text
TypeScript typecheck             PASS
Core build                       PASS
Extension build                  PASS
Automated tests                  56 / 56 PASS
Manifest version                 0.6.0
Built JavaScript syntax          PASS
HTML duplicate-ID inspection     PASS
Stored ZIP import                PASS
Deflate ZIP import               PASS
ZIP CRC validation               PASS
ZIP path traversal rejection     PASS
ZIP decompression limit          PASS
ContextVault import              PASS
ContextVault multi-ZIP import    PASS
Official export import           PASS
Numbered official JSON import    PASS
Direct conversations.json        PASS
Duplicate prevention             PASS
Changed-record re-index          PASS
Stale import non-regression      PASS
Chinese search tokenization      PASS
Role/source search filters       PASS
Historical branch search         PASS
```

## Browser execution limitation

A real Chromium IndexedDB navigation test was attempted through both localhost and file URLs. The managed container policy blocked both navigation forms before application code executed. This is an environment restriction, not a passing browser test. The browser UI and real IndexedDB path therefore remain explicitly unverified in this environment.

## Known boundaries

- ZIP64 archives are rejected with a clear error.
- Encrypted ZIP archives are rejected.
- Supported ZIP compression methods are stored and deflate.
- The current import safety ceiling is 100,000 entries and 2 GB total uncompressed bytes per selected archive set.
- Search indexing is local and may consume significant browser quota for very large corpora.
- Assets are preserved in backup packages but Batch 4 does not yet perform OCR or binary-document full-text extraction.
