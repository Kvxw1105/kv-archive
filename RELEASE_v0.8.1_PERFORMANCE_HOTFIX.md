# ContextVault v0.8.1 — Large-corpus Performance Hotfix

This release addresses a real browser-process crash during a large full-account backup.

## Changed behavior

- Full-account collection no longer immediately builds a ZIP.
- ZIP generation is a separate action after collection.
- Large archives are generated sequentially in approximately 12–24 MB volumes.
- Only one volume is retained while it is generated and written to disk.
- Completed volumes are checkpointed and remaining volumes can resume.
- Progress is phase-aware and long operations emit heartbeat status.
- Log and render work are bounded.
- Conversation and attachment scans no longer use quadratic full-list filtering.
- Large JSON and attachment transport avoid unnecessary duplicate memory representations.

## Compatibility

The v0.8.0 backup database, evidence library, Agent Bundle workflow and approved project-state history remain compatible. Upgrade by replacing files in the existing unpacked extension directory and clicking Reload; do not remove the extension first.

## Validation

- 82 automated tests passed.
- Typecheck, core build, extension build and Agent Bridge build passed.
- A 1,200-conversation synthetic corpus produced 29 valid sequential volumes and about 171 MB of ZIP output with a measured peak JavaScript heap increase of about 14.5 MB.

## Honest boundary

The user's exact failing corpus has not yet been rerun. The release is therefore marked locally verified with real-corpus acceptance pending.
