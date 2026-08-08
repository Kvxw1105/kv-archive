# ContextVault Batch 5 Verification

Version: 0.7.0
Date: 2026-07-26
Status: COMPLETED_LOCALLY / REAL_HOST_ACCEPTANCE_DEFERRED

## Scope verified

- Browser local-library export to a read-only Agent Bundle ZIP.
- Current-evidence-only bundle selection with Project, source, archive-state and date filters.
- Standalone Node.js Agent Bridge without runtime package installation.
- MCP over stdio using newline-delimited JSON-RPC.
- Seven read-only tools: stats, Projects, search, conversation reading, Project snapshot, evidence retrieval and Context Pack generation.
- Deterministic Context Packs with estimated 2K, 8K and 32K token budgets.
- Evidence provenance URI on every selected excerpt.
- CLI inspect and pack workflows.
- Codex, VS Code and generic MCP-host configuration examples.

## Commands and evidence

### TypeScript

Command:

```text
npm run typecheck
```

Result: PASS.

### Automated regression

Command:

```text
npm test
```

Result:

```text
tests: 67
pass: 67
fail: 0
```

The suite includes real child-process MCP smoke tests for initialize, tools/list and tools/call.

### Build outputs

Commands covered by the test/build pipeline:

```text
npm run build:core
npm run build:extension
npm run build:agent
```

Result: PASS.

All built JavaScript in the extension and standalone bridge passed `node --check`.

### Synthetic Agent Bundle integration

A generated Agent Bundle was inspected and tested with the standalone bridge.

Observed content:

```text
conversations: 2
messages: 6
evidence records: 2
projects: 1
readOnly: true
supported budgets: 2048, 8192, 32768
```

System `unzip -t` verified all Bundle entries.

A 2K Context Pack for a known phrase produced:

```text
estimated tokens: 194
sources: 1
truncated: false
```

The generated excerpt included a `contextvault://conversation/...` evidence URI.

### Safety and governance checks

- No MCP mutation tool is exposed.
- All tool annotations declare read-only, non-destructive and idempotent behavior.
- Raw evidence reads are character-bounded.
- Browser Bundle generation has a default 512 MiB safety cap.
- Binary attachments are excluded from Agent Bundles.
- Old evidence versions remain in the browser evidence library but are not mixed into the active Agent Bundle.
- Corrupted ZIP CRC and unsafe paths are rejected.

## Deferred acceptance

The following paths are not claimed as verified:

- registering the MCP server in the user's real Codex, Claude Code, Cursor or VS Code environment;
- exporting a Bundle from the user's full real IndexedDB corpus;
- performance near the 512 MiB browser Bundle limit;
- exact tokenizer counts for any one proprietary model.

These do not invalidate the local protocol and artifact verification, but remain real-host acceptance work.

## Completion calibration

- Code implementation: COMPLETED.
- Local typecheck/build/test: COMPLETED.
- Packaged bridge execution: required as the release gate and recorded separately during packaging.
- Git commit/push/PR/CI/public release: NOT PERFORMED.

## Final packaged-artifact smoke test

The standalone Agent Bridge ZIP was extracted into a clean directory and executed from that extracted package, not from the source workspace.

Results:

```text
inspect: PASS
context pack CLI: PASS
MCP initialize: protocol 2025-06-18
MCP tools discovered: 7
MCP search_messages: PASS
provenance URI in generated pack: PASS
```

The packaged sample contained two conversations, six messages, two evidence records and one Project. The packaged 2K Context Pack remained at 194 estimated tokens with one cited source and no truncation.
