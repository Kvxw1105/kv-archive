# Real Acceptance — KV Archive v0.16.10

Run this against the owner's existing v0.16.9 data before widening Alpha distribution. Record actual observed results; do not convert local automation into a PASS claim.

## A. In-place Chrome upgrade and data preservation

1. Back up the currently loaded extension folder and one important archive/recovery package.
2. Upgrade in place using `INSTALL_v0.16.10.md`; do not remove/reinstall first.
3. Confirm extension version 0.16.10.
4. Confirm existing Local Library conversations, Raw Evidence references, Capture notes/versions, Project State, approved Memory, Memory Gate receipts and scheduler settings remain available.
5. Run `清空会话索引` only on a disposable/test import and verify governed data/Evidence remain intact.

PASS requires no unexpected data loss and no IndexedDB migration/recovery prompt.

## B. Large Project Agent export

Use a Project that is small relative to the total local library and has both conversations and local notes.

1. Export only that Project as an Agent Bundle.
2. Record elapsed time, Chrome memory behavior and whether the workspace stays responsive.
3. Inspect the Bundle: all conversations/messages/current Evidence for the Project are present; unrelated Projects are absent; local note content/state is present where expected.
4. Repeat once after switching to a different Project to catch stale-selection leakage.

PASS requires scope correctness, no whole-library freeze/crash and valid current Evidence.

## C. Notes PWA Project export/recovery

1. Open the existing Notes PWA data set on Android Chrome if available; desktop Chrome is acceptable as a preliminary run.
2. Select a Project containing multiple note revisions and export a Portable Capture package.
3. Validate/import it into a disposable target and confirm all selected object versions arrive.
4. Confirm unrelated Project versions are absent.
5. Repeat with a date-filtered export if that path is part of the user's real workflow.

PASS requires complete selected history with no cross-Project leakage.

## D. Service Worker cache isolation

Best performed on a test origin that contains one unrelated Cache Storage entry.

1. Create/confirm a cache whose name does not begin with `kv-archive-notes-`.
2. Upgrade/reload the Notes PWA so the v0.16.10 Service Worker activates.
3. Inspect Cache Storage.

PASS requires stale `kv-archive-notes-*` caches to be removed while the unrelated cache remains.

## E. Agent handoff truth

1. Give a fresh local Agent only the v0.16.10 source tree.
2. Ask it to report the current version, database versions, protected data boundaries and next planned development node.
3. Verify it reads `AGENTS.md` plus `.agent-harness/CURRENT_STATE.md` and does not describe the repository as an initial PLANNED prototype.

PASS requires no stale v0.16.2/current-state claim and no proposal to rebuild already completed core systems.

## F. Still outside this acceptance

- Git commit/push/PR/CI;
- App Store/Play distribution;
- long-term multi-device synchronization;
- final integration with the separate note-app prototype.
