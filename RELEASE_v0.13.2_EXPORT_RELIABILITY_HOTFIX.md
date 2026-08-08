# KV Archive v0.13.2｜Export Reliability Hotfix

## Why this release exists

A real long ChatGPT conversation was exported as only the last user turn plus several assistant-authored execution fragments, while the HTML still displayed `完整性：完整` and `内容：精简对话`. This was a core archive correctness failure.

v0.13.2 changes the current-conversation pipeline so that a partial last-turn event package cannot silently masquerade as the complete conversation.

## Root causes addressed

1. The debugger adapter resolved the first same-ID object containing `mapping` and `current_node`. Streaming or execution responses can contain a small partial conversation object before the authoritative full conversation response arrives.
2. Compact rendering treated every node with `role === assistant` as a final answer. ChatGPT also authors commentary, tool dispatch and progress nodes as assistant messages.
3. Integrity status checked graph shape but did not require a verified source, a continuous root-to-leaf chain or successful semantic classification.
4. Cumulative/delta fragments with one stable message identity were not coalesced before display filtering.

## Changed behavior

### Authoritative capture first

Current ChatGPT export now first requests:

```text
/backend-api/conversation/{conversationId}
```

inside the authenticated ChatGPT tab. The response must match the current conversation ID and have a continuous parent chain to a root.

The debugger listener remains as a compatibility fallback. It now gathers and scores all same-ID conversation candidates instead of accepting the first one. A fallback capture that cannot prove it came from the authoritative conversation endpoint is marked `unknown`, so it cannot receive a verified-complete label.

### Semantic message classification

Canonical nodes now distinguish:

- `user`
- `assistant_final`
- `assistant_intermediate`
- `tool_call`
- `tool_result`
- `reasoning`
- `system`
- `developer`
- `unknown`

Compact mode includes only `user` and `assistant_final`. Assistant-authored tool calls are no longer rendered as normal ChatGPT replies.

### Stream coalescing

Consecutive nodes with the same provider-supplied stream group or message ID are coalesced before filtering and rendering. Cumulative fragments keep the longest completed form; delta fragments are concatenated.

### Honest integrity labels

HTML labels are now:

- `完整性：已验证完整`
- `完整性：可能不完整`
- `完整性：失败`
- `完整性：未验证`

`COMPLETE` requires a verified capture source, a continuous current branch and no active-path parse failures.

### Diagnostic report

The integrity report now records:

- total and message node counts;
- current branch count;
- user and final assistant counts;
- intermediate, tool and reasoning counts;
- filtered technical nodes;
- unknown active nodes and unknown content parts;
- whether a root was reached;
- parent breaks and active-path continuity;
- capture mode and source completeness;
- first and last message timestamps.

## Compatibility

- Canonical Schema remains v0.2.
- Legacy v0.1 data and `projectId` remain readable.
- Conversation Basket, historical backup, low-memory ZIP volumes, Agent Bundle, Continuity Benchmark, Project State, Memory and Obsidian exports remain supported.
- The hotfix does not implement Gemini or DeepSeek structured adapters.

## Status

`LOCALLY_VERIFIED`. Real logged-in Chrome acceptance remains required, especially against the original long conversation and a conversation containing Skill/search/file tool events.
