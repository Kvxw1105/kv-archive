# ContextVault v0.9.0 — Scheduled Incremental Backup and Logical Snapshots

ContextVault v0.9.0 adds an automatic incremental layer above the existing full-backup engine. Scheduled tasks update the local durable store and create logical snapshots; they do not create another self-contained ZIP on every run.

## Why this design

A portable full ZIP necessarily repeats its own files. Running that every three days would waste disk, download bandwidth, and browser memory. v0.9.0 therefore separates:

1. recurring incremental collection into the local object store;
2. lightweight logical snapshots that point to shared objects;
3. explicit low-memory ZIP generation only when a portable cold backup is needed.

## Scheduled operation

The Full Backup page now contains a **Scheduled Incremental Backup** panel. It supports daily, 3-day, weekly, and 30-day intervals, a local execution time, idle-only execution, attachment policy, and snapshot retention.

When Chrome/Edge is closed at the scheduled moment, the extension cannot execute. The next browser startup reconciles the persisted schedule and queues the missed occurrence. A logged-in ChatGPT tab must still be available when the run actually starts.

Alarm executions use short durable slices. If a scan does not finish in one slice, ContextVault saves the existing job checkpoint and schedules a continuation rather than holding one extension service worker indefinitely.

## Incremental and deduplication rules

- list metadata is scanned first;
- new conversation ID: fetch;
- changed server update version: fetch;
- unchanged version: reuse local object;
- removed/moved source: reconcile current references;
- same conversation payload hash: reuse object;
- same attachment binary hash: reuse object;
- unchanged overall state: do not create a new snapshot.

Each snapshot contains a delta against its predecessor and records object references rather than copying object payloads.

## Retention and reclamation

The user can set a maximum number of snapshots and maximum age. The newest snapshot is always retained. After old snapshots are removed, ContextVault traverses the current object references and every remaining account snapshot, then deletes only truly unreferenced content objects.

## Default attachment policy

Scheduled runs default to **references only**. This records which files are referenced without repeatedly downloading large binaries. Users may enable downloading new attachments, subject to the configured safety limit.

## Upgrade

Do not remove the old unpacked extension. Replace files in the same directory and click Reload in `chrome://extensions/` or `edge://extensions/`. IndexedDB upgrades from version 5 to version 6 and preserves existing backup, attachment, library, and state stores.

## Deferred next slice

- Batch 7C: reviewed memory packs and one-click ChatGPT composer injection;
- Batch 7D: low-token retrieval cache, local semantic retrieval option, and token/cost telemetry.
