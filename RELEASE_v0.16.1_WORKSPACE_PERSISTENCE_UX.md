# KV Archive v0.16.1 — Workspace Persistence UX

Status: `LOCALLY_VERIFIED`

This release fixes three high-friction extension behaviors:

- Conversation Basket selections now auto-save and restore after reopening.
- The ChatGPT conversation catalog is cached in IndexedDB and shown immediately on reopen; refresh is explicit and failed refreshes retain the cache.
- Popup workspace actions reuse one existing KV Archive tab. Internal transitions stay in that tab instead of creating repeated extension tabs.

The former “Memory Sync” surface is renamed to “Project Context”. It explains that Project is a local work scope and that the feature does not write to ChatGPT official memory. A single Project is auto-selected; multiple Projects remember the previous choice.

IndexedDB schema version: 13. New store: `conversation-catalogs`.

Real Chrome acceptance remains pending.
