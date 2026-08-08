# KV Archive Master PRD

Version: living product document  
Baseline implementation: v0.16.11  
Updated: 2026-08-09

## Product definition

KV Archive is a local-first AI work-history and continuity system. It preserves high-fidelity AI conversation evidence, turns selected material into searchable/project-scoped knowledge, governs memory and state, and prepares verifiable handoff context for future AI Agents.

Its long-term product loop is:

**Capture → Preserve → Find → Govern → Hand off → Verify → Continue → Recover**

See `docs/PRODUCT_NORTH_STAR.md` for the full end-state definition.

## Primary users

- heavy users with long-running AI conversations and Projects;
- developers working across ChatGPT/Codex/Cursor/Claude Code/local Agents;
- researchers, students and creators who need durable evidence and project continuity;
- users who want low-friction notes/capture without giving up provenance and recoverability.

## Core jobs

### J1 — Preserve my AI work

When an AI conversation or artifact matters, I can save it with enough source fidelity and diagnostics that I know what was captured and what failed.

### J2 — Maintain it incrementally

After a baseline exists, unchanged content is reused and changed conversations can be updated without repeatedly duplicating the whole corpus.

### J3 — Find the exact thing later

I can search by content, role, Project, date, source and related objects without hidden truncation.

### J4 — Turn history into current project state

I can promote reviewed information into Decision, Task, Memory and Project State while preserving evidence and versions.

### J5 — Give a new Agent the right context

I can build a budgeted Context Pack, apply Memory Gate, send it to a new Agent and verify the handoff with a Continuity Benchmark.

### J6 — Capture thoughts and external material with low friction

I can write a note or share a useful fragment quickly; organization can happen later and does not block capture.

### J7 — Recover and move my data

I can restore from versions/snapshots, export portable packages, move to another device or external knowledge system, and understand exactly what was transferred.

## System layers

1. Browser Capture Adapter
2. Evidence / Content-addressed Archive
3. Local Library and Search
4. Editable Capture / Notes
5. Project State and Memory Governance
6. Agent Continuity and Verification
7. Knowledge/External Adapters
8. Future Desktop and Device Sync

The browser Extension is one surface in this system. Long-term storage, device sync and background runtime should progressively move toward a dedicated local runtime.

## Product rules

- Local-first and zero-token by default.
- Evidence is immutable or append-only; derived views can be rebuilt.
- Partial work is labeled partial.
- Unknown data and failures remain observable.
- Agent writes enter through proposals and review.
- Large-library behavior must be bounded and measurable.
- Destructive operations require explicit scope and recovery thinking.
- User-facing complexity is progressively disclosed.
- Supported formats keep compatibility or receive an explicit migration path.

## Current v0.16.11 baseline

Locally implemented capabilities include conversation/archive capture, history backup, resumption, scheduled/incremental backup, content-addressed snapshots, conversation-node dedup, Local Library, Project State, Memory Gate, Agent Bundle/MCP/CLI, Continuity Benchmark, Verified Handoff, Obsidian export, Portable Capture recovery and Notes PWA Alpha.

Current baseline remains `LOCALLY_VERIFIED`; real owner-profile Chrome/device/external-Agent acceptance is incomplete.

## Active priorities

1. Establish GitHub as engineering source of truth and preserve the v0.16.11 baseline.
2. Execute real incremental/scheduler acceptance before further browser feature expansion.
3. Freeze/audit the separate note-app prototype and design the Repository/Adapter Integration Bridge.
4. Move toward durable Desktop/local runtime and multi-device sync after the data contract is stable.
5. Continue Time Machine, Outcome Ledger, graph exploration and optional semantic capabilities only after core continuity/recovery loops are trustworthy.

## Product-level acceptance

`docs/MASTER_ACCEPTANCE_STANDARD.md` is normative for claims of readiness. A feature existing in code is insufficient evidence by itself.
