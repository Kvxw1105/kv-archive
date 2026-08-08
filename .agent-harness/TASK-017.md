# TASK-017 — Multi-Provider Foundation and Conversation Basket

Status: `LOCALLY_VERIFIED`

## Goal

Make the core conversation contract provider-neutral and deliver a durable whole-conversation selection/export path without regressing the existing ChatGPT backup and continuity stack.

## Completed

- Canonical Schema v0.2 and v0.1 upgrade compatibility.
- Provider registry, capability matrix and conversation URL gating.
- Visible-only generic DOM capture with explicit partial status.
- User-opt-in generic capture on unknown pages.
- ConversationRef and durable ConversationSelectionSet.
- ChatGPT ordinary/archived/Project catalog merger.
- Conversation Basket UI.
- Selected-conversation durable jobs and low-memory ZIP reuse.
- IndexedDB v9 selection store.
- 159/159 tests, typecheck, syntax checks and three performance smokes.

## Protected behavior

Do not remove legacy projectId, evidence URIs, existing stores, backup checkpoints, approved state/memory versions, Agent Bundle compatibility, Obsidian stable paths or Continuity Benchmark gates.

## Not completed

- Real Chrome and account acceptance.
- Gemini/DeepSeek structured adapters or official import.
- Native provider-sidebar checkbox injection.
- Cross-provider remote catalog aggregation.
- Memory Gate.
