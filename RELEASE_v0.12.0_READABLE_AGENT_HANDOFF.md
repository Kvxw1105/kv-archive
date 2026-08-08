# KV Archive v0.12.0 — Readable Export & Agent Handoff

Date: 2026-07-27
Engineering status: **EDITED + LOCALLY_VERIFIED**
External status: **real loaded-extension, real ChatGPT account, and real Obsidian acceptance pending**

## Release intent

v0.12.0 separates three jobs that were previously mixed together:

1. a human-readable conversation export;
2. a complete technical evidence archive;
3. a bounded context layer for local search and Agent continuation.

It also turns the Obsidian ZIP from a bare file dump into an Agent-ready delivery package and reduces first-screen GUI density without removing advanced controls.

## Implemented

### Readable conversation export

- HTML and Markdown default to `readable` mode.
- Tool calls, raw tool results, reasoning summaries, empty internal nodes, and unsupported internal events are hidden from the reading flow.
- A technical view remains available inside the complete ZIP as:
  - `technical-evidence.html`
  - `technical-evidence.md`
- Raw evidence remains available as `raw.json`, `canonical.json`, and `integrity-report.json`.
- The complete backup filename now uses the public product name: `*-KV-Archive.zip`.

### Link and artifact fidelity

- Ordinary web links remain clickable.
- File, image, citation, Canvas, and generated-artifact records render as user-facing cards when a usable URL can be recovered.
- Signed, `blob:`, and `sandbox:` links are labeled as potentially temporary.
- When the original conversation URL is known, the export offers `打开原对话` as a fallback.
- v0.12.0 preserves links and metadata by default; it does not promise permanent remote availability and does not silently download every binary.

### Lean search and Agent context

- Local indexing excludes `tool_call`, `tool_result`, `reasoning_summary`, and `unknown` parts by default.
- User text, final assistant text, code, and user-visible file/citation labels remain searchable.
- Raw canonical and source evidence are still stored for audit and recovery.
- Obsidian conversation bodies use the same readable-content policy.

### Obsidian Agent Handoff

Every generated Vault now includes:

- `00 Home/START_HERE.md`
- `00 Home/IMPORT_OPTIONS.md`
- `00 Home/AGENT_PROMPT.md`
- `99 System/AGENT_HANDOFF.md`
- `99 System/kv-import-manifest.json`
- `99 System/kv-import-receipt.template.json`

The handoff contract requires:

- read-only preflight;
- explicit choice between a new Vault, an existing Vault namespace, or report-only mode;
- no overwrite of `.obsidian`, existing notes, or attachments;
- no silent installation, CLI enabling, PATH modification, elevation, deletion, or destructive cleanup;
- conflict reporting, validation, and a rollback receipt.

The Obsidian Export Center adds a `复制 Agent 交接指令` action after preview.

### GUI simplification

- Backup scheduling is moved into a collapsed advanced section.
- Secondary recovery and diagnostic actions are moved under `更多操作与排错`.
- The execution ledger is collapsed by default.
- Obsidian structure, content, attachment, and volume parameters are moved into advanced options.
- Primary task buttons and all existing control IDs remain available.

## Protected behavior

- Database schema remains unchanged.
- v0.11.3 conversation-first backup and attachment-failure isolation remain unchanged.
- Raw JSON, canonical evidence, integrity reports, snapshots, stable Obsidian paths, and local attachment records remain available.
- No destructive data migration was introduced.

## Local verification

Executed successfully in the source workspace:

- `npm test` — **141/141 passed** after a clean core, extension, and Agent Bridge build.
- JavaScript syntax checks passed for changed extension entry points.
- `npm run test:obsidian-performance`:
  - 3,000 conversations;
  - 3,002 nodes and 6,001 edges;
  - 0 broken links;
  - 0 invalid Canvas references;
  - maximum concurrent conversation reads: 1.
- `npm run test:performance`:
  - 1,200 conversations;
  - 29 bounded ZIP volumes;
  - maximum concurrent artifact reads: 1.
- Built extension manifest reports version `0.12.0`.

## Not yet verified

- Loading v0.12.0 over the user's existing unpacked extension while retaining its extension identity and IndexedDB.
- A live ChatGPT export containing real generated files, uploaded files, signed URLs, expired URLs, and ordinary links.
- A live large-account backup resume from the user's existing checkpoint.
- A real Obsidian import into both a new Vault and an existing Vault.
- A real local Agent executing the included handoff safely.
- Visual acceptance in the user's normal Chrome environment at 100%, 125%, and 150% zoom.

## Out of scope

Smart Selection and a dedicated Capture Library are not included in this release. They remain separate follow-up work and are not represented as completed v0.12.0 functionality.
