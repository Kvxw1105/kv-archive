# KV Archive v0.14.0 Real Acceptance

1. Export a current Agent Bundle from KV Archive.
2. Run:

```bash
node dist/agent/index.js memory-gate --bundle /path/to/bundle.zip --project "PROJECT" --policy balanced --token-budget 2048 --output ./memory-gate-result
```

3. Confirm all six files are created.
4. Review at least one active decision, one superseded record, one active task and one missing-evidence record.
5. Confirm approved Project State was not modified.
6. Build a gated pack:

```bash
node dist/agent/index.js pack --bundle /path/to/bundle.zip --project-title "PROJECT" --query "next milestone" --budget 8192 --memory-gate balanced --output ./context-pack.md
```

7. Confirm superseded/inactive records are absent, review-required records are not silently included, and Evidence URIs resolve locally.
8. Run the same inputs twice with a fixed `--generated-at` during diagnostic testing and confirm identical reports.
