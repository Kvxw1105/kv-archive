# TASK-032 — Note App Prototype Integration Discovery

Status: BLOCKED_BY_TASK_031_OR_OWNER_PRIORITY

## Goal

Preserve the separate note-app prototype's UI/interaction investment while connecting it to KV Archive data/version/recovery/Agent capabilities.

## Discovery deliverables

- prototype repository/tree and build/run commands;
- UI routes/components/state/storage inventory;
- feature parity matrix against KV Archive Notes PWA;
- Repository interface required by the UI;
- Adapter mapping from UI operations to KV Archive content/version/project/search contracts;
- migration/coexistence strategy;
- first vertical slice recommendation.

## Non-goals

- no brute-force frontend merge;
- no wholesale redesign before the inventory;
- no direct coupling of UI components to browser-specific IndexedDB internals if a Repository boundary can isolate it.
