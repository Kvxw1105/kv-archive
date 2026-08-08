# TASK-001 — Gate 0 and Core Skeleton

## Objective

Create the repository foundation and prove one deterministic pipeline with synthetic fixtures.

## Scope

1. Initialize pnpm Monorepo.
2. Add `packages/domain`, `packages/normalizer`, `packages/renderers`, `packages/integrity`, `apps/cli`.
3. Define Canonical Schema v0.1 with Zod.
4. Add one synthetic multi-branch ChatGPT fixture.
5. Convert fixture to canonical JSON.
6. Render active path to Markdown.
7. Generate integrity report.
8. Add type check, unit tests and snapshot test.

## Non-goals

- Browser extension.
- Real ChatGPT authentication.
- Internal API calls.
- Attachments.
- SQLite.
- MCP.
- AI summarization.

## Acceptance criteria

- Unknown content types survive normalization as raw payloads.
- Full graph and active path are both present.
- Markdown output is deterministic.
- Integrity report counts nodes, active-path messages, unknown types and orphan nodes.
- Root commands run successfully.
- No real user data is committed.

## Verification

Record exact commands and results for type check, unit tests, snapshot test and build.

## Stop conditions

Stop and report instead of broadening scope when:

- upstream license or provenance is unclear;
- proposed Schema cannot preserve a source field without loss;
- the task requires browser behavior to prove correctness;
- unrelated repository changes appear.
