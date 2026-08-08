# KV Archive v0.14.3 Real Acceptance

Do not replace the previous unpacked extension folder. Load v0.14.3 from a new directory and retain v0.14.2 for rollback.

## A. IndexedDB upgrade

1. In v0.14.2 create two notes, edit one note and create one relation.
2. Close every open KV Archive page.
3. load v0.14.3 and open Capture Center.
4. confirm all current notes, versions, relations, operations and promotions remain.
5. confirm the browser console contains no blocked database upgrade or missing-store error.

Expected: schema 11 → 12 adds the receipt store without rewriting existing records.

## B. Export and dry-run

1. Select one Project in the content stream.
2. export a Portable Capture ZIP.
3. inspect the ZIP: it must contain `manifest.json` and five JSON record files.
4. choose the same ZIP for import.
5. run conflict analysis.

Expected: an unchanged local Vault reports zero writes and allows only a no-change receipt. No write happens before explicit confirmation.

## C. Empty-profile recovery

1. Use a clean Chrome profile or a temporary extension data reset.
2. load v0.14.3.
3. choose the exported ZIP and run dry-run.
4. verify expected create/version/relation/operation/promotion counts.
5. confirm apply.
6. compare titles, bodies, revisions, relations and promotion history with the source profile.

Expected: all editable Capture records are restored. Raw conversation evidence and Project State remain absent unless separately restored by their own workflows.

## D. Conflict blocking

1. In the target profile create a note with the same id but a different Project or divergent body/revision.
2. analyze the source ZIP.

Expected: the plan shows a Project, revision/hash or divergent-history conflict; apply is disabled and no records are written.

## E. Rollback boundary

1. apply a package containing at least one new note.
2. use the import receipt to run rollback.
3. confirm the note and only the records introduced by that receipt are removed.
4. repeat the import, edit the imported note or create a relation/promotion from it, then request rollback.

Expected: the clean import rolls back with a new append-only receipt. Later local work blocks rollback and remains intact.

## F. Unbound scope

1. keep one unbound note and one Project-bound note.
2. select “未绑定 Project” and export.
3. inspect the manifest and record files.

Expected: the package is marked unbound and contains no Project-bound object.

## Acceptance status

Record exact package id, payload hash, dry-run counts, receipt ids, conflicts and rollback result. Mark v0.14.3 `REAL_ACCEPTED` only after A–F pass without data loss.
