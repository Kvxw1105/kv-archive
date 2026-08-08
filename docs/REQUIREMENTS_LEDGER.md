# KV Archive Requirements Ledger

Status vocabulary: `LOCAL_IMPLEMENTED`, `REAL_ACCEPTANCE_PENDING`, `PLANNED`, `DEFERRED`.

| ID | Requirement | Status | Primary evidence / next gate |
|---|---|---|---|
| R-001 | Preserve raw AI conversation evidence and graph structure | LOCAL_IMPLEMENTED | Real current/long conversation regression |
| R-002 | Truthful COMPLETE/PARTIAL/FAILED diagnostics | LOCAL_IMPLEMENTED | Owner-profile edge cases |
| R-003 | Resumable large-history backup with bounded memory | LOCAL_IMPLEMENTED | Real large account |
| R-004 | Scheduled incremental backup and missed-run catch-up | REAL_ACCEPTANCE_PENDING | `REAL_V0.16.11_ACCEPTANCE.md` |
| R-005 | Conversation-node physical dedup for continued long chats | LOCAL_IMPLEMENTED | Two real post-upgrade continuations |
| R-006 | Content-addressed logical snapshots and safe GC | LOCAL_IMPLEMENTED | Real retention cycle |
| R-007 | Local Library search without hidden truncation | LOCAL_IMPLEMENTED | Real large-library timing/coverage |
| R-008 | Project-scoped bounded Agent export | LOCAL_IMPLEMENTED | Real large Project corpus |
| R-009 | Project State / Decision / Task governance | LOCAL_IMPLEMENTED | Real project-state acceptance |
| R-010 | Memory Gate with deterministic decisions/reasons | LOCAL_IMPLEMENTED | Real conflicting/stale memories |
| R-011 | Continuity Benchmark and Verified Handoff | LOCAL_IMPLEMENTED | External Agent acceptance |
| R-012 | Obsidian structured Vault/graph export | LOCAL_IMPLEMENTED | Real Obsidian Graph/Backlinks/assets |
| R-013 | Notes PWA low-friction local note flow | LOCAL_IMPLEMENTED | Android/iPhone real-device acceptance |
| R-014 | Integrate separate note-app prototype through Repository/Adapter boundary | PLANNED | Prototype freeze/audit + interface spec |
| R-015 | Smart Selection / Share Target / Capture Inbox | PLANNED | Browser/mobile capture vertical slice |
| R-016 | Desktop durable runtime and local object store | PLANNED | Desktop architecture spike |
| R-017 | Phone ↔ desktop incremental sync with conflict receipts | PLANNED | Local LAN pairing vertical slice |
| R-018 | User-owned storage adapters (NAS/WebDAV/cloud folder) | PLANNED | Sync contract must stabilize first |
| R-019 | Stellar/local knowledge graph exploration | PLANNED | Local-graph usability experiment |
| R-020 | Project Time Machine | PLANNED | Snapshot/state temporal contract |
| R-021 | Outcome Ledger / Experience Graph | PLANNED | Project State + Time Machine first |
| R-022 | Optional semantic advisor/search without weakening deterministic truth layer | DEFERRED | Core reliability and privacy first |
| R-023 | Public GitHub engineering source of truth with CI and agent governance | PLANNED | TASK-030 |
