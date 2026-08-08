# TASK-031 — Real Browser Reliability Acceptance

Status: BLOCKED_BY_TASK_030

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
