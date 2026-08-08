# KV Archive v0.13.3｜Long Conversation Hydration Hotfix

## Why this release exists

Real-browser retesting proved that v0.13.2 fixed compact-mode tool-chain leakage and honest completeness labels, but the original long conversation still exported only the last user/assistant turn.

The remaining defect occurred before normalization and rendering: some valid ChatGPT conversation URLs were not routed into the structured ChatGPT adapter. They silently fell back to a DOM snapshot containing only the currently rendered tail of a long conversation.

## Confirmed root cause

v0.13.2 recognized structured ChatGPT capture only for URLs shaped exactly like:

```text
https://chatgpt.com/c/{conversationId}
```

ChatGPT conversations opened through a Project, GPT, or another nested route can still contain a valid `/c/{conversationId}` segment while having path prefixes. Those pages were detected as ChatGPT but incorrectly classified as visible-only capture.

The visible-only adapter then read the current DOM once. Long conversations with lazy loading or virtualization therefore produced only the last rendered turn.

## Changed behavior

### One shared ChatGPT conversation URL rule

Popup guidance and background capture now use the same provider-neutral route helper. Any ChatGPT or legacy Chat OpenAI URL containing a valid `/c/{conversationId}` path segment enters structured ChatGPT capture, including nested Project/GPT routes.

### Upward history hydration fallback

When the authoritative API and debugger capture cannot prove a complete structured tree, KV Archive now:

1. finds the conversation scroll container;
2. captures the currently rendered message window;
3. scrolls upward in overlapping steps;
4. waits for lazy-loaded history;
5. repeats until the top remains stable for multiple rounds;
6. accumulates each virtualized DOM window;
7. merges overlapping windows using stable message/turn IDs when available;
8. preserves identical text from different turns when their IDs differ;
9. restores the user's approximate original scroll position;
10. exports the larger readable branch while retaining `PARTIAL` completeness.

The page movement is intentionally visible so users can tell that older history is being loaded.

### Structured-versus-DOM arbitration

An uncertain debugger candidate is no longer automatically preferred. If upward DOM hydration accumulates more user-visible conversation messages than the uncertain structured candidate, the hydrated branch is exported and marked partial.

A verified authoritative structured response still wins and does not need DOM scrolling.

### A-to-D diagnostics

Readable HTML now contains a collapsed `导出诊断（A → D）` section:

- A: raw source/mapping nodes or accumulated DOM messages;
- B: traced parent-chain or hydrated page messages;
- C: normalized active-path messages;
- D: messages rendered by the selected export mode.

The same counts are stored in the integrity report and capture metadata.

## Compatibility

- Canonical Schema remains v0.2.
- v0.13.2 semantic filtering, stream coalescing and integrity labels remain intact.
- Conversation Basket, historical backup, Agent Bridge, Memory, Project State, Continuity Benchmark and Obsidian paths are unchanged.
- DOM hydration is a recovery path and never claims verified completeness.

## Status

`LOCALLY_VERIFIED`.

The exact original long conversation still requires real-browser re-export with v0.13.3. Do not delete source conversations until that acceptance passes.
