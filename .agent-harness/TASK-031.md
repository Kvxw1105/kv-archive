# TASK-031 — Real Browser Reliability Acceptance

Status: IN PROGRESS — OWNER CHROME EVIDENCE PENDING

## Goal

Turn v0.16.11 scheduled/incremental claims into owner-profile Chrome evidence.

## Acceptance chain

1. In-place upgrade without uninstalling the prior extension.
2. Existing IndexedDB/library/state remains visible.
3. Backup Center scheduler UI has no countdown/progress crash.
4. Establish or confirm baseline snapshot.
5. Continue an old conversation once; incremental run reports it as updated.
6. Continue it again; next incremental run shows positive physical reuse.
7. Exercise ten-minute Alarm and missed-run catch-up.
8. Record exact observed results/screenshots/logs with private content redacted.

Fix only reproduced defects and open a scoped branch/PR for each coherent root cause.

## Closure pass (2026-09-10)

- PR baseline revalidated at `1fd73576ae04a9b42e3236499a63857f37a63606`; PR #3 is OPEN/CLEAN and its prior `verify` check is SUCCESS.
- Current build was copied over the same unpacked-extension path after a private rollback copy was created; no uninstall or IndexedDB clearing was performed. Owner must still click Chrome's Reload control before this build is treated as loaded.
- Deterministic evidence is current: typecheck PASS, 297/297 tests PASS, timeout regression PASS, chunk reuse smoke PASS (`10,000` nodes / `9,999` reused), scheduler transition tests PASS, and all required performance gates PASS.
- Remaining owner-profile gates: export a fresh recovery package, reload the same extension identity, prove second-continuation physical reuse, recheck Backup Center terminal-state convergence on a fresh page, measure real large-library search and Project export, and exercise missed-schedule catch-up across a clean Chrome close/reopen.
- Until those observations exist, TASK-031 remains in progress; no release or merge is implied.
