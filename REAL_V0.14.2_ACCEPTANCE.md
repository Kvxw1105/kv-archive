# KV Archive v0.14.2 Real Acceptance

Do not overwrite the v0.14.1 unpacked extension folder. Load v0.14.2 from a separate directory so rollback remains possible.

## 1. IndexedDB upgrade

1. In v0.14.1, confirm existing Library, Project State, Memory Gate receipts and backup history are visible.
2. Load v0.14.2 using the same Chrome profile.
3. Confirm those existing records remain readable.
4. Open DevTools Application → IndexedDB → `context-vault`.
5. Confirm database version 11 and the five new `capture-*` stores exist.
6. Confirm existing `content-objects` Raw Evidence records were not moved or rewritten.

Pass only when prior data remains intact and Capture Center opens without an upgrade error.

## 2. Capture lifecycle

Create one flash, one note, one web excerpt and one AI excerpt. Test:

- unbound and Project-bound records;
- independent Project filtering in the content stream;
- editing creates v2 rather than overwriting v1;
- restore v1 and confirm it creates a new current revision;
- archive, trash and restore;
- search by body and tag;
- no duplicate download or unexpected network request.

## 3. Conflict and relation safety

1. Open the same record in two extension pages.
2. Save an edit in the first page.
3. Attempt to save the stale revision in the second page.
4. Confirm a revision-conflict error appears and the newer content remains intact.
5. Create a typed relation within one Project.
6. Attempt a direct relation between two different Projects and confirm it is rejected.

## 4. Promotion governance

- Promote a Project-bound note to Decision and Task.
- Confirm each becomes a review-required Project State proposal.
- Confirm approved Project State does not change before review.
- Generate a Memory promotion and confirm it exports a draft rather than silently approving it.

## 5. Graph and Obsidian

Use a Project with notes and relations but no AI conversations:

- generate the Project graph;
- export Obsidian;
- open it in Obsidian;
- confirm `70 Content`, MOC links and Canvas references work;
- confirm graph integrity reports 0 broken content evidence links.

## 6. Agent Bundle v3

- export a Bundle containing content records;
- inspect manifest counts for objects, versions, relations, operations and promotions;
- run Agent Bridge inspect/search/read;
- verify `contextvault://content/...` provenance resolves to the exact revision;
- confirm a Context Pack can cite both a conversation and a note;
- confirm an older v1 or v2 Bundle remains readable.

## Acceptance status

Mark `FIXED_VERIFIED` only after all applicable sections pass. Record failures with the exact Chrome version, extension path, database version, object ID/revision and reproduction steps.
