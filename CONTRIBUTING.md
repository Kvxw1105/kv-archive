# Contributing

KV Archive is currently an Alpha engineering project. Read `AGENTS.md` before changing runtime code.

## Workflow

- Create a focused branch for one main objective.
- Keep private/user data out of fixtures and issues.
- Add a regression test for bug fixes where practical.
- Run `npm run typecheck` and `npm test` before PR submission; run relevant performance gates for storage/backup/search/graph/handoff changes.
- Describe data/schema/compatibility impact and real-environment gaps in the PR.
- Do not select/change the project license as part of an unrelated contribution.

## Completion language

A local test pass means `LOCALLY_VERIFIED`; it does not imply CI, release or real-device/browser acceptance.
