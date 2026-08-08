# TASK-022 · Unified Capture / Note / Stellar Graph Contract

Status: `LOCALLY_VERIFIED`

## Goal

Add a provider-neutral editable content layer that supports local notes and excerpts without contaminating immutable Raw Evidence, and make that layer usable by graphs, Obsidian and receiving Agents.

## Completed

- unified content, version, relation, operation and promotion contracts;
- independent IndexedDB stores under database version 11;
- Capture Center create/edit/version/archive/trash/restore/search/filter workflows;
- optimistic revision conflicts and cross-Project relation protection;
- review-required Memory/Decision/Task promotion;
- exact content evidence URI verification;
- knowledge graph and notes-only Obsidian integration;
- Agent Bundle v3 with all content versions, relations, operations and promotions;
- read-only Agent/MCP content search and Context Pack provenance;
- Agent Bundle v1/v2 compatibility;
- 209/209 tests and three performance smokes.

## Protected contracts

- Raw Evidence `content-objects` remains immutable and separate;
- existing conversation Evidence URIs and Project State remain compatible;
- promotion never silently approves state;
- Agent/MCP content access remains read-only;
- low-memory conversation backup behavior remains unchanged.

## Remaining

- real Chrome and IndexedDB 10 → 11 acceptance;
- real concurrent-page conflict test;
- real notes-only Obsidian opening;
- real receiving-Agent Bundle v3 acceptance;
- portable Capture Package import/recovery;
- Git/CI/release.
