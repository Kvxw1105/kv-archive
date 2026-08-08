# KV Archive v0.14.2 — Unified Capture / Note / Stellar Graph

v0.14.2 adds a provider-neutral editable content layer for notes, flashes, web excerpts, AI excerpts, images and files. This layer is deliberately separate from immutable Raw Evidence: editable records may change through explicit revisions, while captured conversations and binary evidence remain untouched.

## User-visible changes

- New **记录中心 / Capture Center** for creating, editing, archiving, trashing and restoring local content.
- Content stream filters are independent from the Project selected in the editor.
- Every edit creates an immutable revision and operation-log entry.
- Previous revisions can be restored as a new current revision.
- Typed relations connect records without embedding relation state into note bodies.
- Content can be promoted into review-required Memory, Decision or Task drafts.
- Notes and excerpts enter Project knowledge graphs and Obsidian exports, including Projects that have no AI conversations.

## Unified content contract

Supported content kinds:

- `note`
- `flash`
- `web_excerpt`
- `ai_excerpt`
- `conversation`
- `image`
- `file`

The contract carries Project identity, tags, source references, attachment references, current revision, lifecycle state, content hash and stable evidence URI. Typed relations include references, derived-from, supports, depends-on, supersedes, related-to and contains.

Stable content evidence uses:

```text
contextvault://content/{objectId}?revision={revision}&hash={contentHash}
```

Evidence resolution verifies the exact revision and content hash rather than trusting only a mutable object ID.

## Local database and safety boundary

IndexedDB schema advances from 10 to 11 and adds:

- `capture-items`
- `capture-versions`
- `capture-relations`
- `capture-operations`
- `capture-promotions`

The existing `content-objects` store remains the immutable Raw Evidence object store. v0.14.2 does not migrate editable notes into that store and does not rewrite existing evidence.

Updates use optimistic revision checks. Stale edits fail with a revision conflict rather than silently overwriting a newer revision. Cross-Project relations are rejected until an explicit external-link workflow exists.

## Knowledge graph and Obsidian

Unified content becomes first-class graph nodes. Content relations become graph edges, and graph validation resolves exact content evidence. Obsidian output adds a stable `70 Content` area and includes content in Project MOCs and Canvas graphs.

A Project containing only notes and relations can now produce a valid knowledge export without requiring a conversation record.

## Agent Bundle v3 and MCP

Agent Bundle format advances to v3 and may include:

- current content objects;
- immutable content versions;
- typed relations;
- operation logs;
- pending promotion records.

Agent Bridge remains compatible with Bundles v1 and v2. It can search and read unified content, cite stable content provenance in Context Packs, and exposes read-only MCP tools:

- `list_content_objects`
- `search_content`
- `read_content_object`

Promotion remains review-required. Agent reads do not mutate local notes or approved Project State.

## Status

Code, automated tests and performance smokes are locally verified. Real Chrome interaction, IndexedDB 10 → 11 in-place upgrade, actual notes-only Obsidian opening and real Bundle v3 handoff remain pending.
