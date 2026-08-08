# TASK-009 — Batch 7C Memory Sync Center

Status: LOCALLY_VERIFIED
Version: 0.10.0

## Goal

Generate evidence-backed core memory, Project memory, and task context from the local vault; require review before durable Project memory approval; support copy, portable bundle export, and explicit insertion into the ChatGPT composer without auto-send or silent native-memory mutation.

## Acceptance

- Project-scoped deterministic memory generation.
- 2K/8K/32K budget enforcement and token estimate.
- Evidence URIs retained.
- Candidate Diff against approved memory.
- Immutable approved memory versions in IndexedDB.
- Copy, ZIP export, and composer insertion.
- No automatic message send and no ChatGPT saved-memory endpoint use.
