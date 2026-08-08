# KV Archive

> Local-first AI work history, evidence preservation and verifiable Agent continuity.

KV Archive helps users preserve AI conversations and related material, find them later, govern project state/memory, and hand a project to a new AI Agent with evidence and verification.

Current public-handoff baseline: **v0.16.11**. The code is locally verified; several real Chrome/device/external-Agent acceptance paths are still pending. Treat the repository as Alpha engineering software until those gates close.

## Why this exists

Long-running AI work becomes fragile when its history lives only inside one chat window, model, account or vendor. KV Archive aims to give the user a durable local layer for:

- high-fidelity conversation evidence and exports;
- resumable history and incremental backup;
- content-addressed snapshots and long-conversation node reuse;
- local search and Project organization;
- editable Notes/Capture with versions and recovery;
- Project State, Memory Gate and reviewed changes;
- Agent Bundle / MCP / CLI / Context Pack;
- Continuity Benchmark and Verified Handoff;
- Obsidian and future desktop/mobile adapters.

See [`docs/PRODUCT_NORTH_STAR.md`](docs/PRODUCT_NORTH_STAR.md) and [`PRD.md`](PRD.md).

## Repository map

- `apps/extension/` — Chrome/Edge MV3 capture, backup and product surfaces
- `apps/pwa/` — mobile-first Notes PWA
- `apps/agent/` — continuity / benchmark / Agent logic
- `apps/agent-bridge/` — packaged local Agent bridge sources
- `packages/` — shared contracts/core logic
- `tests/` — deterministic regression suite
- `scripts/` — build and performance gates
- `.agent-harness/` — current state, task cards, handoff and Agent prompts

## Local setup

Requires Node.js 20+.

```bash
npm ci
npm run typecheck
npm test
```

Performance gates are documented in `AGENTS.md` and can also run through the GitHub manual performance workflow.

## Current engineering state

- Baseline version: `0.16.11`
- Local regression before GitHub handoff: `294/294 PASS`
- TypeScript: PASS
- Performance gates: `7/7 PASS`
- Extension IndexedDB: v13
- Notes PWA IndexedDB: v1
- Real owner-profile browser acceptance: pending

Read `.agent-harness/CURRENT_STATE.md` before changing code.

## Public repository / licensing

This repository is being prepared for public engineering collaboration. A project-level open-source license has **not** been selected yet. Public source visibility does not change copyright by itself. Do not add a license without the owner's decision.

Third-party notices and retained upstream licenses are in `THIRD_PARTY_NOTICES.md` and `licenses/`.

## Security and private data

Do not commit real user conversations, browser-profile databases, tokens, cookies, signed URLs, credentials or unredacted diagnostic bundles. See `SECURITY.md` and `docs/PUBLIC_REPO_POLICY.md`.
