# TASK-005 — Batch 5 Read-only Agent Handoff

Status: COMPLETED_LOCALLY
Version: 0.7.0

## Goal

Expose the Batch 4 evidence library to local coding agents without granting mutation capability.

## Delivered

- filtered Agent Bundle export from the extension library;
- dependency-free local Agent Bridge;
- MCP stdio protocol support pinned to the stable 2025-era lifecycle;
- evidence-backed search, conversation reading, Project snapshots and source retrieval;
- deterministic 2K, 8K and 32K Context Packs;
- provenance URI on every excerpt;
- Codex, VS Code and generic MCP configuration examples;
- direct CLI inspect and Context Pack commands;
- explicit read-only annotations and no mutation tools.

## Acceptance

- full build and typecheck pass;
- all automated tests pass;
- generated Agent Bundle passes ZIP integrity;
- Agent Bridge loads the real generated bundle;
- stdio initialization, tools/list and tools/call work;
- every context excerpt has provenance;
- estimated Context Pack tokens do not exceed the selected tier;
- no create/update/delete/write tool is exposed.

## Deferred

- real ContextVault browser IndexedDB export on the user's corpus;
- direct invocation from installed Codex/Claude/Cursor clients;
- exact model-specific tokenization;
- Batch 6 reviewed write proposals.
