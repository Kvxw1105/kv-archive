# AGENTS.md — KV Archive Development Contract

## Project mission

KV Archive is a local-first AI work-history and continuity system. It preserves high-fidelity evidence, supports searchable/project-scoped context, governs reviewed memory and Project State, hands work to Agents, and captures editable notes across browser/mobile surfaces.

GitHub becomes the engineering source of truth after the public bootstrap. Current implementation status stays in `.agent-harness/CURRENT_STATE.md`; task-specific scope stays in the active task card.

## Read before editing

1. `PRD.md`
2. `docs/PRODUCT_NORTH_STAR.md`
3. `docs/MASTER_ACCEPTANCE_STANDARD.md`
4. `ARCHITECTURE.md`
5. `.agent-harness/CURRENT_STATE.md`
6. `.agent-harness/HANDOFF.md`
7. the active task card

## Repository map

- `apps/extension/` — Chrome/Edge MV3 capture, backup, Local Library, State, Memory Gate, Obsidian and user workflows.
- `apps/pwa/` — mobile-first Notes PWA.
- `apps/agent/` — continuity/benchmark/Agent implementation.
- `apps/agent-bridge/` — packaged local Agent Bridge sources.
- `packages/` — shared contracts and core logic.
- `tests/` — deterministic regression tests.
- `scripts/` — builds and performance gates.
- `.agent-harness/` — current state, tasks, prompts and handoffs.

## Required commands

```bash
npm ci
npm run typecheck
npm test
npm run test:performance
npm run test:snapshot-performance
npm run test:obsidian-performance
npm run test:capture-recovery-performance
npm run test:handoff-performance
npm run test:pwa-performance
npm run test:conversation-chunk-performance
```

Use targeted tests while iterating. Widen verification according to risk before claiming completion.

## Non-negotiable invariants

1. Preserve Raw Evidence before transformation; derived cleanup must not orphan governed evidence.
2. Never silently drop unknown nodes, content types, assets, failures, Project collisions or recovery conflicts.
3. Keep immutable evidence separate from editable Capture/Note content and derived indexes/views.
4. Project State, approved Memory and receipts change only through governed/versioned flows.
5. External Agent access is read-only except explicit proposals; proposals never silently mutate approved state.
6. Default workflows consume zero model tokens unless the user explicitly enables semantic/AI processing.
7. Never persist durable auth tokens/signed temporary URLs or print secrets in logs.
8. Never commit real private conversations or owner browser-profile data.
9. Preserve supported archive, Portable Capture, Evidence URI and Agent Bundle compatibility unless a migration is explicitly designed and tested.
10. Large-library paths use bounded reads/paging/streaming. Do not reintroduce avoidable whole-store reads in scoped operations.
11. PWA cleanup stays inside the KV Archive namespace.
12. Do not brute-force merge the separately developed note-app prototype. Integrate via Repository/Adapter contracts.
13. Do not select a project-level open-source license without owner approval.
14. After the initial baseline import, do not push feature/fix work directly to `main`; use a scoped branch and PR.

## Database/schema policy

- Extension IndexedDB source of truth: `context-vault`, current baseline DB v13.
- Notes PWA IndexedDB source of truth: `kv-archive-notes`, current baseline DB v1.
- Do not bump DB versions for convenience when existing keys/indexes can safely implement the behavior.
- Destructive migration requires backup/recovery, compatibility notes and explicit acceptance.

## Change protocol

Before editing: inspect Git/worktree state, read project/state/task docs, identify protected contracts and locate the real call chain. Search existing patterns/indexes before creating abstractions.

During editing: one principal acceptance target per round; avoid unrelated refactors/dependency upgrades. Inspect actual diff and remove debug output, private paths and accidental generated files.

## Git / PR / CI protocol

Report these levels separately:

`EDITED`, `LOCALLY_VERIFIED`, `COMMITTED`, `PUSHED`, `PR_UPDATED`, `CI_PASSED`, `RELEASED`.

After baseline import:

- branch per task;
- commit only scoped changes;
- push branch and create/update PR;
- verify CI belongs to the current head SHA;
- do not merge or release automatically unless the task explicitly grants that permission.

## Handoff

Every substantial node updates `.agent-harness/CURRENT_STATE.md` and `.agent-harness/HANDOFF.md` with behavior changes, verification commands/results, data/schema impact, Git seven-level status, unresolved real-environment risks and next three actions.
