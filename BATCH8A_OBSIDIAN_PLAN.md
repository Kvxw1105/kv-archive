# Batch 8A — Obsidian Knowledge Graph Export

Status: PLANNED
Target version: 0.11.0
Primary mode: PLAN -> IMPLEMENT

## 1. Product objective

Turn one ContextVault Project into a standalone Obsidian Vault that opens without installing a ContextVault Obsidian plugin.

The first-run experience must be:

```text
Select Project
-> preview export structure and warnings
-> export Vault ZIP
-> extract and open the folder as an Obsidian Vault
-> Graph View immediately shows meaningful links
-> Project Canvas opens with a curated project map
```

The graph is the acquisition hook. The durable value remains ContextVault's evidence, memory, project-state, search, and Agent handoff layers.

## 2. Acceptance criteria

A Batch 8A release is complete only when all of the following are true:

1. A user can select one Project and export an Obsidian Vault ZIP.
2. The ZIP contains valid Markdown notes, YAML properties, wiki links, a Project MOC, a home dashboard, and a JSON Canvas file.
3. The Vault opens in Obsidian without a community plugin.
4. Every managed conversation links to its Project note.
5. Decisions, tasks, and approved memories link to the Project and to available evidence conversations.
6. The Canvas uses valid JSON Canvas 1.0 nodes and edges and references existing files.
7. Broken internal links, duplicate node IDs, duplicate managed paths, and invalid Canvas references are zero.
8. Repeated exports reuse stable paths and do not create duplicate notes when extracted over the same managed Vault.
9. Export generation consumes zero model tokens.
10. Large Projects use bounded-memory sequential reads and sequential ZIP volumes rather than `getAll()` over all message bodies.
11. ContextVault never writes into an existing user Vault in Batch 8A; it only produces explicit downloadable packages.
12. Existing backup, memory, state, Agent, and HTML export behavior remains unchanged.

## 3. Explicit non-goals

Batch 8A will not include:

- an Obsidian community plugin;
- automatic two-way synchronization;
- silent writes into an existing Vault;
- Notion or SiYuan publishing;
- model-generated concept extraction;
- a replacement for Obsidian Graph View;
- editing ContextVault state from Obsidian;
- deletion of obsolete files from a user's existing Vault.

These boundaries prevent an export feature from turning into an unsafe sync engine.

## 4. Architecture decision

Use a provider-neutral graph intermediate representation and a thin Obsidian renderer.

```text
Indexed ContextVault records
        |
        v
KnowledgeGraphIR
        |
        +--> Obsidian Markdown renderer
        +--> JSON Canvas renderer
        +--> Manifest and link validator
        +--> future Notion adapter
        +--> future SiYuan adapter
```

Do not place Obsidian-specific path rules inside the canonical ChatGPT schema or state-governance modules.

### 4.1 New package: `packages/knowledge-graph`

Pure TypeScript, deterministic, no browser APIs.

Proposed contracts:

```ts
export type KnowledgeNodeKind =
  | "project"
  | "conversation"
  | "decision"
  | "task"
  | "memory"
  | "evidence"
  | "asset";

export interface KnowledgeNode {
  id: string;
  kind: KnowledgeNodeKind;
  title: string;
  body: string;
  properties: Record<string, string | number | boolean | string[] | null>;
  evidenceUris: string[];
  sourceHash: string;
  preferredPath?: string;
}

export interface KnowledgeEdge {
  id: string;
  from: string;
  to: string;
  relation:
    | "belongs_to"
    | "supports"
    | "derived_from"
    | "depends_on"
    | "supersedes"
    | "summarizes"
    | "references";
  evidenceUri?: string | null;
}

export interface KnowledgeGraphIR {
  format: "context-vault-knowledge-graph";
  schemaVersion: 1;
  projectId: string;
  generatedAt: string;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}
```

### 4.2 New package: `packages/obsidian-exporter`

Responsibilities:

- stable managed-path allocation;
- YAML frontmatter rendering;
- Obsidian wiki-link rendering;
- Markdown note rendering;
- MOC and dashboard generation;
- JSON Canvas generation;
- manifest generation;
- link and graph-quality validation;
- low-memory export descriptors.

It must not read IndexedDB directly.

### 4.3 Extension integration

New surface:

```text
apps/extension/src/knowledge.html
apps/extension/src/knowledge.css
apps/extension/src/knowledge.js
apps/extension/src/knowledge-export.js
apps/extension/src/knowledge-export-store.js
```

The popup and Memory Sync Center will link to a new “Knowledge Graph Export” page.

## 5. Trusted node model for v0.11.0

Batch 8A must favor semantic precision over node count.

### Included nodes

- Project: exactly one root node.
- Conversation: one node per indexed Project conversation.
- Decision: approved Project-state decisions only.
- Task: approved Project-state tasks only.
- Memory: approved core and Project memory versions.
- Evidence index: a small number of index notes, not one noisy node per excerpt.
- Asset: only downloaded local assets that can be linked safely.

### Deferred nodes

Free-form Concept and Person extraction is deferred until a quality gate exists. Automatically turning every noun into a node would create an impressive but unusable hairball graph.

## 6. Obsidian Vault layout

```text
ContextVault-Obsidian-Vault/
├── 00 Home/
│   ├── ContextVault Home.md
│   └── Export Guide.md
├── 10 Projects/
│   └── <stable-project-path>.md
├── 20 Conversations/
│   └── <stable-conversation-path>.md
├── 30 Decisions/
│   └── <stable-decision-path>.md
├── 40 Tasks/
│   └── <stable-task-path>.md
├── 50 Memories/
│   ├── <project>-core-memory.md
│   └── <project>-project-memory.md
├── 60 Evidence/
│   └── Evidence Index.md
├── 80 Canvas/
│   └── <project>-project-map.canvas
├── 90 Attachments/
└── 99 System/
    ├── contextvault-manifest.json
    ├── path-map.json
    └── export-report.json
```

The export will not write internal Obsidian configuration under `.obsidian/` in v0.11.0. This avoids depending on undocumented configuration formats and avoids overwriting a user's own settings.

## 7. Markdown contract

Properties must be flat because Obsidian properties do not support nested structures well.

Example conversation note:

```md
---
contextvault_id: "conversation:abc123"
contextvault_type: conversation
contextvault_schema: 1
contextvault_managed: true
project: "[[10 Projects/video-forge__p123]]"
created: 2026-07-20T12:00:00.000Z
updated: 2026-07-26T09:00:00.000Z
archived: false
source_provider: chatgpt
source_hash: sha256:...
tags:
  - contextvault/conversation
---

# AtlasDemo Project Handoff

> [!info] ContextVault source
> Evidence: `contextvault://...`

Project: [[10 Projects/video-forge__p123]]

## Conversation

...
```

Rules:

- quote internal links used in YAML properties;
- render links in note bodies as well as properties;
- preserve Evidence URIs as text and machine-readable properties;
- preserve active-path order;
- record unknown content rather than silently dropping it;
- escape filenames and YAML values deterministically.

## 8. Stable path and idempotency design

Human-readable titles can change, so filenames cannot be recalculated from the latest title on every export.

Introduce a path registry keyed by ContextVault node ID:

```text
node ID -> allocated managed path -> source hash -> last exported at
```

First export allocates a readable path with a short stable ID suffix. Later exports reuse the stored path even if the title changes.

Proposed IndexedDB additions for schema v8:

- `knowledge-export-profiles`
- `knowledge-export-paths`
- `knowledge-export-runs`

The exported manifest includes the same path map. Batch 8B can later use it for safe incremental synchronization.

Batch 8A package behavior:

- full Vault ZIP contains all current managed files;
- stable paths allow extraction over the same Vault without duplicate managed notes;
- removed records are listed in `export-report.json` but are not automatically deleted from an existing Vault;
- no user-authored file is ever overwritten by the extension because Batch 8A never writes directly to the Vault.

## 9. Canvas design

Use JSON Canvas 1.0 only.

The Project Canvas is curated rather than exhaustive:

- center: Project;
- upper area: approved core and Project memory;
- left group: active decisions;
- right group: active tasks;
- lower group: recent or evidence-linked conversations;
- edge labels: supports, derived from, depends on, supersedes;
- maximum default file nodes: 36;
- overflow is represented by links to MOC notes rather than thousands of Canvas cards.

The global Graph View remains exhaustive; the Canvas remains readable.

## 10. Bounded-memory export pipeline

Do not call the current `exportAgentRecords()` for a very large Project because it loads all messages and evidence into arrays.

Add streaming-friendly store methods:

- `listProjectConversationRefs(projectId)`;
- `getConversationDetail(conversationKey)`;
- `getProjectState(projectId)`;
- `getApprovedMemory(projectId)`;
- `listProjectAssetRefs(projectId)`;
- async iteration or cursor pagination for large record sets.

Pipeline:

```text
read Project metadata
-> allocate stable paths
-> build lightweight graph index
-> plan ZIP volumes
-> read one conversation detail
-> render one Markdown entry
-> release source record
-> continue
-> build and download one ZIP volume
-> release Blob
```

Target defaults:

- approximately 24 MB per volume;
- approximately 12 MB on low-memory devices;
- one conversation detail in memory at a time;
- one ZIP volume in memory at a time;
- pause and resume between volumes.

## 11. User interface

The Knowledge Graph Export Center will contain:

1. Project selector.
2. Export summary: conversations, decisions, tasks, memories, assets.
3. Structure mode:
   - Compact: Project + conversations + current state.
   - Standard: Compact + decisions + tasks + approved memories.
4. Content mode:
   - Full conversation Markdown.
   - Compact conversation note with source summary and evidence link.
5. Attachment option:
   - links only;
   - include locally downloaded assets.
6. Validation preview:
   - node count;
   - edge count;
   - orphan count;
   - broken-link count;
   - estimated output size;
   - expected volume count.
7. Export button, pause-after-current-volume control, and resumable progress.

No AI model is called during export.

## 12. Implementation sequence

### Phase 0 — Fixtures and contracts

Deliverables:

- synthetic Project fixture with conversations, branch data, decisions, tasks, memory, evidence, and one attachment;
- KnowledgeGraphIR schema and validators;
- golden expected node/edge fixture.

Completion gate:

- deterministic graph hash across repeated runs;
- no missing evidence references.

### Phase 1 — Graph compiler

Deliverables:

- Project/state/memory/conversation to KnowledgeGraphIR compiler;
- stable IDs and typed relations;
- no Obsidian-specific formatting.

Completion gate:

- duplicate node IDs: 0;
- dangling edges: 0;
- each conversation belongs to the selected Project.

### Phase 2 — Obsidian renderer

Deliverables:

- flat YAML properties;
- Markdown files and wiki links;
- MOC and home dashboard;
- manifest and path map;
- JSON Canvas renderer.

Completion gate:

- every generated link resolves to an exported file;
- JSON Canvas validates against the 1.0 contract;
- file paths are portable on Windows, macOS, and Linux.

### Phase 3 — Export Center and persistence

Deliverables:

- extension page and navigation;
- schema v8 path registry and export-run state;
- preview, validation, export, progress, pause, and resume.

Completion gate:

- repeated exports reuse paths;
- closing and reopening the page resumes remaining volumes;
- no direct write to an existing Vault.

### Phase 4 — Large-project and regression gate

Deliverables:

- 1,200-conversation Project stress test;
- 3,000-conversation graph-index stress test;
- ZIP volume and heap measurements;
- regression across backup, memory, state, Agent, and HTML export.

Completion gate:

- at most one full conversation detail live at once;
- no `getAll()` over all Project messages in the Obsidian export path;
- bounded heap growth;
- existing regression suite remains green.

### Phase 5 — Real Obsidian acceptance

Manual evidence checklist:

- open exported folder as a Vault;
- Graph View shows expected cluster;
- Project, Decision, Task, Memory, and Conversation groups are distinguishable by tags/properties;
- Canvas opens and all file cards resolve;
- backlinks and outgoing links work;
- attachments open;
- second export does not create duplicate managed notes.

Container verification cannot replace this external-app acceptance.

## 13. Test plan

New tests:

```text
tests/knowledge-graph.test.mjs
tests/obsidian-markdown.test.mjs
tests/obsidian-canvas.test.mjs
tests/obsidian-path-registry.test.mjs
tests/obsidian-export-integration.test.mjs
tests/obsidian-export-performance.test.mjs
```

Required assertions:

- deterministic graph output;
- valid YAML delimiters and scalar escaping;
- internal-link target existence;
- Windows-reserved filenames handled;
- title changes do not allocate a second path;
- same node hash does not generate a changed-file record;
- missing evidence remains visible in export report;
- unknown canonical content remains represented;
- Canvas node and edge IDs are unique;
- Canvas file references exist;
- no raw auth token, signed asset URL, or secret is exported;
- large data path stays bounded.

## 14. Risk register

### Graph hairball

Prevention: trusted node types only, no automatic free-form concept extraction, Canvas node cap, MOC pages.

### Path drift and duplicates

Prevention: persistent ID-to-path registry and stable suffixes.

### User edits overwritten

Prevention: Batch 8A produces packages only; direct Vault writes are deferred to a conflict-aware plugin.

### Memory regression

Prevention: cursor reads, sequential rendering, sequential volume building, stress gate.

### Private data leakage

Prevention: local-only generation, explicit attachment option, secret and signed-URL scan, no telemetry.

### Obsidian implementation drift

Prevention: use Markdown, flat YAML properties, wiki links, and JSON Canvas 1.0; do not write undocumented Obsidian configuration.

## 15. Release and follow-up sequence

### v0.11.0 — Batch 8A

Single-Project native Obsidian Vault export.

### v0.11.1 — Batch 8A.2, only after real acceptance

- multi-Project whole-vault export;
- optional user-curated topic nodes;
- export-delta report improvements;
- visual graph presets documented for users.

### Batch 8B — Obsidian Companion Plugin

- connect to local ContextVault Bridge;
- pull incremental changes;
- update only managed files;
- conflict detection;
- no silent overwrite;
- Obsidian edits become reviewable ContextVault proposals.

### Batch 8C — Notion adapter

Use KnowledgeGraphIR; cloud/API permissions remain explicit.

### Batch 8D — SiYuan adapter

Use KnowledgeGraphIR and local HTTP API.

### Existing roadmap preservation

Batch 7D Low-token Agent Mode remains approved and follows the first Obsidian export release unless a critical defect gate intervenes. Batch 7E Message-level Chunk Deduplication remains after 7D.

## 16. First implementation slice

The first coding slice will be Phase 0 + Phase 1 only:

```text
synthetic Project fixture
-> KnowledgeGraphIR types
-> deterministic Project/state/memory/conversation compiler
-> node/edge validation
-> golden tests
```

This slice produces no UI and no ZIP, but it is a complete architecture-risk test: it proves that existing ContextVault evidence can be transformed into a stable, meaningful graph without Obsidian-specific coupling or model calls.
