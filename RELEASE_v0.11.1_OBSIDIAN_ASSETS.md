# ContextVault v0.11.1 — Obsidian Assets

v0.11.1 closes the attachment gap in the plugin-free Obsidian Vault exporter.

## Added

- **Include locally downloaded attachments** and **Skip binaries** export modes.
- Project/conversation attachment discovery from the local content-addressed backup store.
- Stable, extension-preserving paths under `90 Attachments/`.
- Metadata-only preview and size estimation.
- Deferred one-at-a-time binary loading during ZIP generation.
- Object-key/SHA verification before materialization.
- Included/missing attachment counts in analysis and export reports.
- Sample Vault with a real PNG attachment.

## Safety and compatibility

- no network fetch occurs during Obsidian export;
- missing binaries are reported instead of silently fabricated;
- the exporter still does not write into an existing Vault;
- `skip` mode preserves the v0.11.0 lightweight behavior;
- no new IndexedDB schema migration is required beyond schema v8.

## Verification

- 128/128 automated tests passed;
- 3,000-conversation Obsidian pressure test passed;
- 1,200-conversation low-memory backup regression passed;
- sample Vault ZIP contains the expected attachment bytes.


## Packages

The extension, source and sample Vault archives were unpacked and checked. The complete test suite was rerun from the unpacked source archive and passed 128/128.
