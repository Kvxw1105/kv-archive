# KV Archive v0.16.0 — Notes PWA Alpha

## Purpose

Turn the existing unified note and recovery contracts into a usable phone-first surface without prematurely committing to a native shell or synchronization backend.

## User-visible capabilities

- rapid flash/note/web-excerpt/AI-excerpt capture;
- optional title, Project, tags and source URL;
- offline-first local timeline and search;
- Project, kind and status filters;
- immutable edit history and restore-as-new-version;
- archive, trash, restore and cancel archive;
- Portable Capture export, dry-run import, conflict blocking, recovery receipts and safe rollback;
- installable manifest, icons, shortcuts and service-worker offline shell;
- bounded 80-row initial timeline with incremental loading.

## Architectural boundary

The PWA uses a separate editable IndexedDB database and reuses the portable Capture contract. It does not write into immutable Raw Evidence storage. It is a PWA Alpha, not a native APK/iOS application and not a synchronized multi-device service.

## Completion status

- implementation: completed locally;
- automated verification: completed locally;
- local Chromium runtime smoke: reproduced;
- physical Android/iPhone acceptance: pending;
- app-store/native-shell delivery: not implemented.
