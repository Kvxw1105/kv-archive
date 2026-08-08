# ContextVault v0.11.1

ContextVault backs up ChatGPT conversations and assets, imports ContextVault/OpenAI archives into a local searchable evidence library, exports Agent Bundles, reviews Agent-generated project-state proposals, maintains reviewed memory, and exports one Project as an Obsidian knowledge graph.

v0.11.1 retains the provider-neutral graph compiler and a plugin-free Obsidian Vault export with stable paths, YAML Properties, wiki links, a Project MOC, JSON Canvas, quality reports, and bounded-memory resumable ZIP volumes.

## Upgrade without losing local data

1. Do not remove the existing unpacked extension.
2. Extract v0.11.1 and replace files in the same extension directory.
3. Close any old ContextVault pages.
4. Open `chrome://extensions/` or `edge://extensions/`.
5. Click **Reload** on ContextVault.

The unified IndexedDB schema upgrades to version 8. Existing conversations, attachments, library evidence, approved project states, and previous job progress are preserved.

## Scheduled incremental backup

Open **Full Backup** and use the **Scheduled Incremental Backup** card.

Available frequency presets:

- daily;
- every 3 days;
- weekly;
- every 30 days.

Choose a local execution time, workspace, idle-only behavior, attachment policy, and snapshot retention. The page displays next run, last successful run, snapshot count, latest added/updated/removed conversation delta, duplicate-reference savings, and current scheduler state.

### Runtime requirements

- Chrome/Edge must be running for an extension alarm to execute;
- at least one logged-in ChatGPT tab must be open when the run starts;
- if the browser was closed at the scheduled moment, startup reconciliation queues the missed occurrence;
- scheduled tasks never generate ZIP volumes automatically.

### Time slicing and recovery

Alarm runs use a bounded processing slice. ContextVault saves the existing history job checkpoint, heartbeat, current phase, counters, and continuation time. Remaining work resumes through another alarm instead of keeping one service worker alive indefinitely.

Manual full backup and ZIP generation use the same durable lease as scheduled backup, preventing concurrent mutation of the same local job.

## How incremental collection avoids duplication

1. ContextVault scans lightweight conversation metadata.
2. It downloads only new conversations or conversations whose update version changed.
3. Raw conversation payloads receive stable SHA-256 content-object keys.
4. Attachment binaries receive SHA-256 content-object keys.
5. Artifact and asset rows reference shared objects.
6. A logical snapshot records current references and a delta, not another payload copy.
7. If the complete state fingerprint is unchanged, no new snapshot is created.

The default scheduled attachment policy is **References only**. This records attachment inventory without repeatedly transferring large files. Select **Download new attachments** only when the scheduled local mirror should include binaries.

## Logical snapshots and retention

A snapshot records:

- current conversation object references and source locations;
- current attachment object references;
- unresolved attachment references;
- Projects;
- added, updated, removed, and unchanged deltas;
- logical bytes and unique physical referenced bytes.

Retention combines a maximum snapshot count with a maximum age. The latest snapshot is always preserved. Content-object garbage collection protects current references and every remaining snapshot across all accounts before removing an object.

Content addressing currently operates at complete conversation-payload and attachment-binary granularity. Unchanged conversations are fully reused. A changed long conversation creates a new complete raw evidence object; message-level chunk deduplication is not claimed in v0.11.1.

## Portable full backups

Scheduled snapshots are not standalone archives. When a portable cold backup is needed:

1. finish or refresh local collection;
2. click **Generate low-memory backup volumes**;
3. let ContextVault build and write one volume at a time;
4. extract all volumes into one folder and open `index.html` from the first volume.

This keeps daily automation lightweight while retaining independent portable archives on demand.

## Obsidian knowledge graph export

Open **Obsidian Knowledge Graph Export**, select one Project, choose Standard or Compact structure, choose Full or Compact conversation content, and analyze the export. ContextVault reports node/edge counts, bad graph references, Canvas errors, stable-path reuse and planned ZIP volumes.

Generate all volumes and extract them into the same parent folder. Open the resulting folder as an Obsidian Vault. Graph View is formed from the generated wiki links; `80 Canvas/Project Map.canvas` provides a curated project map.

The exporter reads one full conversation at a time and keeps only one ZIP volume in memory. It never calls a model or API. v0.11.1 does not write directly into an existing Vault. It can copy attachment binaries already downloaded into ContextVault; missing assets are reported and are not fetched from the network during export.

## Existing capabilities retained

- regular, archived, and Project conversation backup;
- images, documents, generated files, integrity reports, and retries;
- ChatGPT-style HTML export with floating directory and search;
- local official-OpenAI/ContextVault import and full-text search;
- Agent Bundle, MCP/CLI Agent Bridge, evidence URIs, and Context Packs;
- reviewed state proposals, immutable versions, conflict detection, and rollback;
- branded Kv extension icon.

## Next product slice

- Batch 7D: local retrieval cache, optional local embeddings, token budgets, and usage/cost telemetry;
- Batch 7E: message-level chunk deduplication;
- Batch 8A.2/8B: only after real Obsidian acceptance, multi-Project expansion and conflict-safe managed-folder synchronization.
