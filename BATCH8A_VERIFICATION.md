# Batch 8A Verification — Obsidian Knowledge Graph Export

Version: 0.11.0
Status: LOCALLY_VERIFIED
Date: 2026-07-26

## Scope

This verification covers the provider-neutral knowledge graph, Obsidian Markdown/Canvas renderer, stable path registry, extension export center, database schema v8, bounded-memory ZIP volumes, resume state, and regressions against prior ContextVault capabilities.

## Functional evidence

- KnowledgeGraphIR node kinds: Project, Conversation, Decision, Task, Memory, Evidence and optional Asset.
- Typed edge validation detects duplicate IDs, duplicate semantic edges, dangling edges, missing root links and unresolved evidence conversations.
- Graph identity ignores wall-clock generation time and lazily omitted note bodies when stable source hashes are unchanged.
- Obsidian rendering produces flat YAML, wiki links, Home/MOC/Guide notes, JSON Canvas, manifest, path map and export report.
- Stable paths survive title changes.
- Removed managed paths are reported, not silently deleted.
- Export volumes read at most one complete conversation concurrently.
- Scheduled backup, memory, state and Agent boundaries remain unchanged.

## Automated verification

Commands used:

```text
npm run typecheck
npm test
node --expose-gc scripts/obsidian-performance-smoke.mjs .tmp/obsidian-performance-smoke.json
```

Final regression result before packaging:

```text
Automated tests: 127 / 127 passed
Failures: 0
```

## 3,000-conversation pressure result

```text
Conversations:                    3,000
Knowledge nodes:                  3,002
Knowledge edges:                  6,001
ZIP volumes:                      2
Total ZIP output:                 17,371,794 bytes
Largest volume:                   13,159,459 bytes
Maximum concurrent full reads:   1
Total full conversation reads:    6,000
Planning time:                    5,728.59 ms
Build time:                       4,265.65 ms
Heap delta:                       16,413,360 bytes
RSS delta:                        134,922,240 bytes
Broken wiki links:                0
Invalid Canvas references:        0
Status:                           COMPLETE
```

The 6,000 reads are expected: one sequential measurement pass and one sequential volume-build pass. No bulk conversation export API is permitted in this path.

## Security and data boundaries

- no model/API request is made by Obsidian export;
- canonical evidence is read, not mutated;
- v0.11.0 only creates downloadable ZIP files;
- it does not write into an existing Vault;
- it does not delete paths from a user Vault;
- it does not auto-send ChatGPT content;
- it does not approve Agent state changes.

## Remaining risk

Local tests cannot prove compatibility with every Obsidian desktop version, theme or community plugin. Real Graph View, Backlinks, Properties and Canvas acceptance remains pending under `REAL_OBSIDIAN_ACCEPTANCE.md`.

## Packaged-artifact verification

The final extension, source and sample Vault ZIPs were extracted into clean directories.

- extension Manifest parsed as v0.11.0;
- every packaged extension JavaScript file passed `node --check`;
- packaged extension contains the Knowledge Export Center and both graph packages;
- high-confidence API-key/Bearer-token pattern scan found no secret;
- packaged source passed `npm run typecheck`;
- packaged source passed 127 / 127 tests;
- sample Vault contains 17 files and 13 Markdown notes;
- sample Vault broken wiki links: 0;
- sample Vault invalid Canvas references: 0;
- sample Manifest file count: 17, including the Manifest itself;
- all three ZIP integrity checks passed.
