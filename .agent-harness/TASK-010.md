# TASK-010 — Batch 8A Obsidian Knowledge Graph Export

Status: COMPLETED (local implementation and package verification; real Obsidian acceptance pending)
Target version: 0.11.0

## Goal

Export one ContextVault Project as a standalone, plugin-free Obsidian Vault with meaningful wiki links, flat YAML Properties, a curated JSON Canvas project map, evidence traceability, stable managed paths, and bounded-memory ZIP volumes.

## Completed

- synthetic graph fixture and golden contract;
- provider-neutral KnowledgeGraphIR;
- deterministic compiler and graph validation;
- Obsidian path allocation, Markdown, MOC, guide, manifest and JSON Canvas;
- stable path registry and removed-path reporting;
- extension export center;
- sequential two-pass volume planning and generation;
- pause/resume run state;
- database schema v8;
- targeted, integration, full-regression and 3,000-conversation pressure tests.

## Acceptance achieved locally

- deterministic graph hash;
- duplicate node IDs: 0;
- dangling edges: 0;
- every conversation belongs to the selected Project;
- decisions, tasks and memory preserve available evidence references;
- no Obsidian formatting inside the canonical graph model;
- broken wiki links: 0 in test fixtures and pressure run;
- invalid Canvas references: 0;
- maximum concurrent full conversation reads: 1;
- zero model/API token use.

## Not claimed

- no real Obsidian application run in the current environment;
- no direct write into an existing Vault;
- no automatic binary attachment copy;
- no bidirectional sync or user-note overwrite;
- no multi-Project graph release.

## Protected areas

- existing canonical evidence records;
- current backup and scheduled-backup flows;
- approved state and memory version semantics;
- Agent Bridge read/write boundaries;
- existing database data and upgrade compatibility.

## Next gate

Run `REAL_OBSIDIAN_ACCEPTANCE.md` against the user's Obsidian installation. Record observed failures before starting direct sync or multi-Project expansion.
