# KV Archive Agent Bridge v0.16.11

A dependency-free MCP stdio server with read-only conversation evidence, unified notes/content access, review-required state proposals, deterministic Context Packs, and Continuity Benchmark scoring. Requires Node.js 20+.

## 1. Export a bundle

Open KV Archive > Local Library and click **Export Agent Bundle**. Keep the bundle private. Binary attachments are not included.

## 2. Verify the bundle

```bash
node dist/agent/index.js inspect --bundle /path/to/KV-Archive-Agent-Bundle.zip
```

## 3. Start MCP over stdio

```bash
node dist/agent/index.js serve --bundle /path/to/KV-Archive-Agent-Bundle.zip --proposal-dir ./kv-archive-proposals
```

Use the examples in `configs/`. Replace all absolute paths.

## Tools

Read-only evidence and approved-state tools:

- `vault_stats`
- `list_projects`
- `search_messages`
- `list_content_objects`
- `search_content`
- `read_content_object`
- `read_conversation`
- `get_project_snapshot`
- `get_source_evidence`
- `run_memory_gate`
- `build_context_pack`

Controlled proposal tool:

- `create_state_proposal`

The proposal tool writes one JSON file into the local proposal outbox. It cannot approve the file or mutate approved Project state.

## Continuity Benchmark

Create a challenge and private answer key:

```bash
./create-benchmark.sh /path/to/bundle.zip "AtlasDemo" ./benchmark-run
```

Give only `PROMPT.md`, `benchmark-challenge.json`, and `response-template.json` to the receiving Agent. Keep `benchmark-answer-key.json` private.

Score the returned JSON:

```bash
./score-benchmark.sh /path/to/bundle.zip ./benchmark-run/benchmark-answer-key.json ./agent-response.json ./benchmark-report
```

A PASS requires at least 85/100 and no critical identity, evidence, or unsupported-record errors.

## Memory Gate

```bash
./run-memory-gate.sh /path/to/bundle.zip "AtlasDemo" ./memory-gate balanced 2048
```

The report classifies approved-state candidates as INCLUDE, EXCLUDE, or REVIEW and never mutates approved state.

## Paired Memory Gate benchmark

```bash
./create-gate-benchmark.sh /path/to/bundle.zip "AtlasDemo" "Continue the current milestone" ./gate-experiment balanced
./score-gate-benchmark.sh /path/to/bundle.zip ./gate-experiment/benchmark-answer-key.json ./gate-experiment/response-gate-off.json ./gate-experiment/response-gate-on.json ./gate-comparison
```

The scorer reports score and dimension deltas. It does not assume the Gate improves every model or task.

## Verified Handoff

Create a project-scoped receiver package and a separate private verification kit:

```bash
./create-handoff.sh /path/to/bundle.zip "AtlasDemo" "Continue the current milestone" ./handoff-sender balanced
```

Send only the `KV-Archive-Verified-Handoff-*.zip` file. Keep the Verification Kit private.

Receiver preflight and extraction:

```bash
./receive-handoff.sh ./KV-Archive-Verified-Handoff-*.zip ./handoff-receiver Codex
```

After the receiving Agent returns `handoff-response.json`, verify it with the private kit and receiver receipt:

```bash
./verify-handoff.sh ./KV-Archive-Verified-Handoff-*.zip ./KV-Archive-Handoff-Verification-Kit-*.zip ./handoff-receiver/receiver-preflight-receipt-*.json ./handoff-receiver/handoff-response.json ./handoff-verification
```

A verified PASS requires package integrity, matching sender/receiver receipts, a matching approved-state identity, and a Continuity Benchmark PASS with no critical evidence or identity errors.

## Context Pack generation

```bash
node dist/agent/index.js pack --bundle /path/to/bundle.zip --project-title "AtlasDemo" --query "AtlasDemo next milestone" --budget 8192 --memory-gate balanced --output ./context-pack.md
```
