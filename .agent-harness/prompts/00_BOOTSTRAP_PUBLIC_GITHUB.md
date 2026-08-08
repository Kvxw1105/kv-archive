# Prompt — Bootstrap KV Archive into a new public GitHub repository

Work on the repository root containing `AGENTS.md`. Treat this as TASK-030.

## Objective

Create the first durable public GitHub baseline from this prepared v0.16.11 seed, with reproducible CI and truthful handoff evidence. Do not add product features in this task.

## Procedure

1. Read `AGENTS.md`, `docs/PUBLIC_REPO_POLICY.md`, `.agent-harness/CURRENT_STATE.md`, `.agent-harness/HANDOFF.md`, and `.agent-harness/TASK-030.md`.
2. Inspect the full tree and confirm there is no existing `.git` history. If Git history already exists, stop and report the actual state instead of overwriting it.
3. Run public preflight:
   - list ignored/generated files;
   - search common token/private-key/credential patterns;
   - search for machine-local paths and suspicious exported private content;
   - confirm `THIRD_PARTY_NOTICES.md` and `licenses/` are present;
   - confirm no project-level LICENSE has been added.
4. Run baseline verification:
   - `npm ci`
   - `npm run typecheck`
   - `npm test`
   - all seven performance commands listed in `AGENTS.md`.
   If any failure is caused by the seed sanitization, fix only that issue and re-run. If a runtime failure appears unrelated, do not hide it; report and stop before publication if it threatens baseline correctness.
5. Initialize Git: `git init -b main`.
6. Review staged scope before commit: `git add -A`, `git status --short`, `git diff --cached --stat`, `git diff --cached --check`.
7. Create the baseline commit with a message such as `chore: establish v0.16.11 public baseline`.
8. Determine the authenticated GitHub owner with `gh auth status` / `gh api user`. Do not assume an account name from chat history.
9. Check whether `<owner>/kv-archive` already exists. If it exists, stop and ask the owner; do not invent a suffix.
10. Create the repository as public from this local source, without auto-generating README, .gitignore or license. Add remote `origin` and push `main`.
11. Confirm GitHub Actions ran on the pushed head SHA. Wait for the baseline CI result and record the run URL/status.
12. After CI passes, create tag `v0.16.11` and a GitHub **pre-release** explaining that local/CI validation passes while owner-profile real-browser acceptance remains pending. Do not call it stable.
13. If branch protection/rulesets can be configured safely, require PR/CI for future changes. If permissions/plan prevent this, report it; do not treat it as a bootstrap failure.
14. Update `.agent-harness/CURRENT_STATE.md` and `.agent-harness/HANDOFF.md` with repository URL, baseline commit SHA, push/CI/release status and next tasks. Commit/push that state update through a small follow-up branch/PR if main protection is already active; otherwise include it in a clearly scoped follow-up commit.

## Completion report

Report separately: EDITED, LOCALLY_VERIFIED, COMMITTED, PUSHED, PR_UPDATED, CI_PASSED, RELEASED. Include exact repo URL, branch, commit SHA, CI URL, release/tag URL, commands/results, any preflight findings and remaining real-environment risks.
