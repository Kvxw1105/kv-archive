# TASK-018 — Export Reliability Hotfix

Status: `LOCALLY_VERIFIED`

## Goal

Prevent partial last-turn event packages and assistant-authored execution events from being exported as a complete compact conversation.

## Completed

- Authoritative current-conversation API is attempted before debugger capture.
- Debugger fallback scores multiple candidate trees instead of resolving the first object.
- Uncertain fallback captures cannot claim verified completeness.
- Semantic user/final/intermediate/tool/reasoning/system/developer classification.
- Compact and assistant-only modes filter by semantics, not role alone.
- Stable stream fragments are coalesced before rendering.
- Root-chain, active-path, source and parse integrity checks.
- Diagnostic counts and timestamps.
- Long-conversation, tools, branches/failure-shape and streaming regressions.
- 166/166 tests and three performance smokes.

## Protected behavior

Do not regress Conversation Basket, provider-neutral Schema v0.2, legacy v0.1 reading, backup checkpoints, low-memory volumes, Evidence URIs, Agent Bundle, Project State, Memory, Continuity Benchmark or Obsidian stable paths.

## External acceptance pending

Run `REAL_V0.13.2_ACCEPTANCE.md`, especially the exact conversation that generated the seven-message defective HTML.
