# ContextVault v0.7.0 — Batch 5

## Added

- Agent Bundle export from the local library.
- Filtered export by Project, source, archive state and dates.
- Standalone dependency-free Agent Bridge for Node.js 20+.
- MCP stdio support with newline-delimited JSON-RPC.
- Seven read-only tools for search, evidence and Context Packs.
- Context Pack budgets: 2K, 8K and 32K estimated tokens.
- Provenance URI on every selected excerpt.
- Codex TOML, VS Code JSON and generic MCP host examples.
- Direct CLI commands for bundle inspection and Context Pack generation.

## Security and governance

- Agent Bundles are local files and contain private conversation content.
- Binary attachments are excluded.
- Only current evidence versions enter a bundle; older evidence remains in the browser library.
- MCP tools declare `readOnlyHint=true` and expose no mutation operation.
- Raw evidence output is bounded by a configurable character cap.
- Browser Agent Bundle export stops above a 512 MB safety threshold and asks the user to narrow scope.

## Compatibility

The bridge implements the stable 2025-era MCP lifecycle over stdio and accepts protocol versions `2025-06-18`, `2025-03-26` and `2024-11-05`.
