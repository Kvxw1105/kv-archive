# Prompt — Real v0.16.11 Browser Acceptance

Execute TASK-031 only after TASK-030 is complete. Start from a scoped branch such as `test/real-incremental-acceptance` or a bug-fix branch if a defect is reproduced.

Goal: validate the existing v0.16.11 browser/incremental behavior in the owner's real Chrome profile without uninstalling the current extension or destroying IndexedDB data.

Read `REAL_V0.16.11_ACCEPTANCE.md` and `.agent-harness/TASK-031.md`. Capture private evidence locally/redacted; never commit real conversation content or browser DB dumps.

Run the acceptance chain exactly. For each result mark OBSERVED PASS / OBSERVED FAIL / BLOCKED. If a bug reproduces, reduce it to a root cause, add a regression test, implement the smallest fix, run targeted tests and then full required regression. Open/update a PR and keep Git seven-level state explicit.

Do not begin unrelated Notes/Desktop/Graph work in this task.
