# TASK-019 — Nested Route and Long Conversation Hydration Hotfix

Status: `LOCALLY_VERIFIED`

## Goal

Fix the real-browser defect where v0.13.2 still exported only the last turn from a long ChatGPT conversation after compact-mode filtering was repaired.

## Confirmed root cause

The structured-capture gate accepted only root `/c/{id}` URLs. Nested Project/GPT paths containing the same conversation segment fell into a one-shot DOM snapshot. Long lazy-loaded conversations therefore exposed only the rendered tail.

## Completed

- Shared nested ChatGPT conversation URL detection.
- Gradual upward history hydration.
- Virtualized DOM batch accumulation and overlap merging.
- Stable-ID preservation for repeated content.
- Approximate scroll-position restoration.
- Larger-branch arbitration between uncertain structured and hydrated DOM capture.
- A-to-D export diagnostics.
- 168/168 automated tests and three performance smokes.

## Protected behavior

Do not regress semantic compact filtering, stream coalescing, honest completeness labels, Conversation Basket, provider-neutral Schema v0.2, low-memory backup, Agent Bridge, Project State, Memory, Continuity Benchmark or Obsidian paths.

## External acceptance pending

Run `REAL_V0.13.3_ACCEPTANCE.md` against the original private long conversation.
