# KV Archive v0.16.3 — Conversation-title filenames

State: `LOCALLY_VERIFIED`

v0.16.3 improves the filename of current-conversation exports. HTML, Markdown and technical ZIP exports now derive their outer filename from the real conversation title instead of falling back prematurely to generic names such as `ChatGPT.html` or `网页 AI 对话.html`.

## Resolution order

1. Canonical structured conversation title.
2. Original captured title fields.
3. Page or active-tab title, with provider suffixes such as `- ChatGPT` removed.
4. A bounded title derived from the first user message when every available title is generic.
5. Provider plus a short conversation ID as the final deterministic fallback.

## Portability

Generated names remove Windows-forbidden characters, trailing periods/spaces and reserved device names. The content payload, evidence model, library record and database schema are unchanged.
