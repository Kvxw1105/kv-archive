# KV Archive Development Governance

## Development-mode transition

From 2026-08-09 onward, the preferred operating model is:

- **GitHub repository:** engineering source of truth.
- **Local coding Agent:** primary implementation/debugging executor.
- **ChatGPT:** product strategy, requirement clarification, architecture review, adversarial review, acceptance design and high-level handoff generation.
- **Human owner:** product judgment, permissions, real-environment acceptance and irreversible decisions.

Chat sessions should no longer be treated as the only durable development history.

## Branch and PR workflow

After the initial baseline import:

1. `main` contains only reviewed, reproducible states.
2. One principal task per branch, e.g. `fix/scheduler-real-acceptance` or `feat/note-integration-bridge`.
3. Agent must inspect `git status`, AGENTS.md, CURRENT_STATE and the active task card before edits.
4. Run targeted tests during iteration; widen to required regression before claiming `LOCALLY_VERIFIED`.
5. Review the actual diff for unrelated formatting, debug logs, secrets and scope drift.
6. Push branch and open/update a PR.
7. CI must correspond to the pushed head commit.
8. Merge only after acceptance criteria are satisfied and remaining real-environment risks are stated.
9. Update `.agent-harness/CURRENT_STATE.md` and `HANDOFF.md` at every milestone.

## Completion levels

Keep these separate:

`EDITED → LOCALLY_VERIFIED → COMMITTED → PUSHED → PR_UPDATED → CI_PASSED → RELEASED`

No Agent may collapse several levels into a generic “done”.

## Change boundaries

- Preserve existing user data and supported formats by default.
- Schema/database migrations need evidence, backup/recovery design and explicit acceptance.
- Avoid dependency upgrades unrelated to the active task.
- Avoid broad refactors during bug-fix nodes.
- Never silently weaken integrity checks to make tests pass.
- If two consecutive fixes fail to narrow a defect, stop and rebuild the hypothesis before further edits.

## Release policy

- Keep semantic versioning consistent across root, Extension, PWA and Agent Bridge.
- A GitHub release may be marked pre-release when local/CI validation is complete but real owner-profile acceptance is pending.
- Stable release notes must state data/schema impact, compatibility, verification evidence and known gaps.
- Release artifacts should have SHA-256 checksums.
