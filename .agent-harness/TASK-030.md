# TASK-030 — Public GitHub Baseline Bootstrap

Status: READY

## Goal

Create the first public GitHub history from the prepared v0.16.11 seed and establish reproducible CI without changing runtime behavior.

## Must do

- inspect files and preflight privacy/secrets;
- run `npm ci`, typecheck, full tests and required performance gates;
- initialize Git on `main`;
- create one baseline commit;
- create a new public GitHub repository named `kv-archive` if that exact repository name is available;
- push main;
- confirm GitHub Actions on the pushed SHA;
- create a v0.16.11 pre-release only after CI passes;
- update CURRENT_STATE/HANDOFF with exact SHA/URL/status.

## Must not do

- no new product feature;
- no DB/schema/version bump;
- no license selection;
- no owner-private data;
- no invented repository name if `kv-archive` already exists: stop and ask the owner.

## Acceptance

Clean checkout of the public repository can run `npm ci`, `npm run typecheck`, `npm test`; CI is green on the baseline SHA; public preflight has no known secret/private-data blocker.
