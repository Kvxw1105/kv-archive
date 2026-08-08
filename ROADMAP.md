# KV Archive Strategic Roadmap

Updated: 2026-08-09  
Frozen transition baseline: v0.16.11 (`LOCALLY_VERIFIED`)

## Phase 0 — Repository handoff and engineering governance

Goal: make GitHub + local Agent the durable development system.

Deliverables:

- public GitHub repository with sanitized v0.16.11 baseline;
- CI for build/typecheck/regression;
- manual/scheduled performance workflow;
- stable AGENTS.md + `.agent-harness/` state/task/handoff layering;
- public-repo privacy/third-party/license policy;
- pre-release baseline tag after CI passes.

Exit gate: clean checkout → `npm ci` → typecheck/test passes; repository/commit/CI URLs exist; no secrets/private fixtures are published.

## Phase 1 — Real-world reliability closure

Goal: convert the strongest local claims into real-environment evidence.

Priority acceptance:

- owner-profile Chrome in-place upgrade preserving existing IndexedDB data;
- scheduler UI + 10-minute Alarm + missed-run catch-up;
- old long conversation continued twice with positive node reuse on the second post-upgrade continuation;
- real large-library search/Project export timing and scope;
- real Obsidian and external-Agent handoff.

Only reproduced failures should trigger browser hotfixes.

## Phase 2 — Notes product integration

Goal: preserve the separately developed note-app UX while connecting it to KV Archive truth and continuity systems.

Sequence:

1. freeze/audit the prototype;
2. define Repository interface and Adapter boundary;
3. map Note/Capture/Project/version/recycle/search behaviors;
4. connect UI shell to KV Archive core without direct DB coupling;
5. run migration/compatibility and UX acceptance.

Exit gate: the preferred note UI can operate on real KV Archive content while versions, recovery and Agent workflows remain intact.

## Phase 3 — Durable local runtime / Desktop foundation

Goal: move long-lived storage/background responsibilities out of a browser-only lifecycle.

Scope candidates:

- SQLite/local object store;
- background job runtime;
- stable local API/IPC;
- browser Extension as capture adapter;
- device identity, sync manifest, operation log and conflict receipts;
- migration/import from Extension/PWA stores.

Technology choice remains open until this phase begins.

## Phase 4 — Mobile capture and device continuity

Goal: make capture/search/project continuation available away from the desktop.

Scope:

- system Share Target / Capture Inbox;
- Android shell and later iOS share extension;
- local/offline Project subsets;
- LAN pairing and incremental sync;
- optional user-owned WebDAV/NAS/cloud-folder adapters after sync contracts stabilize.

## Phase 5 — Knowledge/time intelligence

Goal: turn reliable history into navigable project evolution.

Scope:

- Project Time Machine;
- Outcome Ledger / Experience Graph;
- typed local knowledge relationships;
- Project/local Stellar Graph exploration;
- conflict/health views for Memory and Project State.

## Phase 6 — Optional semantic intelligence and public beta/stable path

Goal: add semantic power without weakening deterministic evidence.

Scope:

- optional semantic advisor and embeddings;
- duplicate/conflict suggestions;
- model/provider policy, privacy and cost accounting;
- broader AI-platform capture adapters;
- v1.0 readiness review against `docs/MASTER_ACCEPTANCE_STANDARD.md`.

## Explicit deferrals

- team/cloud collaboration before the local-first core is trustworthy;
- automatic mutation of approved project history by an Agent;
- forced cloud account registration;
- premature full 3D knowledge universe before local graph workflows prove useful;
- broad frontend rewrites while real reliability gaps remain.
