# Batch 5 Real Host Acceptance

This checklist is optional and deferred by the user. It does not block Batch 6 development.

## Browser export

- Import or open a real local library.
- Select a Project filter and export an Agent Bundle.
- Confirm one ZIP downloads.
- Run `inspect` and compare conversation/message counts with the library.

## Codex

- Copy `configs/codex-config.toml` into the relevant trusted Codex configuration.
- Replace both absolute paths.
- Restart Codex.
- Confirm seven ContextVault tools are visible.
- Ask Codex to search a known phrase and cite the returned `contextvault://` URI.

## Other MCP hosts

- Use `configs/vscode-mcp.json` or `configs/claude-cursor.json`.
- Confirm initialization, tool discovery and a Context Pack call.

## Pass criteria

- the host starts the bridge without stdout corruption;
- search returns known messages;
- every excerpt includes provenance;
- no mutation tools are listed;
- a 2K Context Pack stays within its estimated budget;
- stopping the host leaves the Agent Bundle unchanged.
