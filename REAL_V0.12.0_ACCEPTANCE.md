# KV Archive v0.12.0 — Real Environment Acceptance

This checklist validates behavior that cannot be proven by local source tests alone.

## 0. Safety before upgrade

- [ ] Download or copy the current v0.11.3 unpacked extension directory.
- [ ] Do not remove the existing extension from Chrome.
- [ ] Keep a separate copy of important ZIP/HTML backups.
- [ ] Record the current extension ID shown in `chrome://extensions`.

## 1. In-place extension upgrade

1. Replace the contents of the existing unpacked extension directory with the contents of the v0.12.0 installation ZIP.
2. Open `chrome://extensions` and click `重新加载` on KV Archive.

Acceptance:

- [ ] Version displays as `0.12.0`.
- [ ] Extension ID is unchanged.
- [ ] Existing backup progress, local library, project state, and approved memories remain present.
- [ ] No database migration or corruption error appears.

## 2. Readable HTML and complete ZIP

Use a real ChatGPT conversation containing:

- normal text and code;
- at least one ordinary external link;
- one uploaded or generated downloadable file when available;
- at least one tool-backed answer.

Acceptance for default HTML/Markdown:

- [ ] User messages and final assistant answers are readable.
- [ ] Tool calls, raw tool JSON, reasoning summaries, and empty `未获取信息` blocks do not interrupt the conversation.
- [ ] Ordinary links remain clickable.
- [ ] File/download entries retain a visible filename or meaningful label.
- [ ] `打开原对话` appears when the source conversation URL is available.
- [ ] Temporary/signed links are not described as permanently available.

Acceptance for complete ZIP:

- [ ] `conversation.html` and `conversation.md` are readable versions.
- [ ] `technical-evidence.html` and `technical-evidence.md` contain the technical events excluded from the reading view.
- [ ] `raw.json`, `canonical.json`, and `integrity-report.json` are present.
- [ ] The ZIP filename ends with `-KV-Archive.zip`.

## 3. Link expiry behavior

- [ ] Test one currently valid file link while logged in.
- [ ] Test the same exported HTML after closing/reopening the browser.
- [ ] Where possible, test an old or expired link.
- [ ] A failed remote link does not break the exported page.
- [ ] The source-conversation fallback still opens the original conversation when permissions allow.

## 4. Backup regression

- [ ] Conversation-first mode remains the default.
- [ ] A conversation-only run completes without downloading attachment binaries.
- [ ] One inaccessible attachment does not invalidate already saved conversations.
- [ ] A real expired login pauses with a session message rather than being silently skipped.
- [ ] An existing large-account checkpoint resumes rather than restarting from zero.

## 5. Obsidian ZIP — new Vault

- [ ] All ZIP volumes are extracted into one directory.
- [ ] `00 Home/START_HERE.md` exists.
- [ ] Obsidian opens the directory as a Vault.
- [ ] `KV Archive Home`, Project MOC, and Project Map Canvas open.
- [ ] Backlinks and Graph View show relationships.
- [ ] No unexpected `.obsidian` configuration is included.

## 6. Obsidian ZIP — existing Vault

- [ ] The project is imported under `KV Archive/<project>`.
- [ ] Existing notes and `.obsidian` remain unchanged.
- [ ] Conflicts are reported rather than overwritten.
- [ ] Wiki Links and Canvas file references still resolve from the nested namespace.

## 7. Local Agent handoff

- [ ] `复制 Agent 交接指令` becomes available after preview.
- [ ] Agent performs read-only preflight before any write.
- [ ] Agent asks for A/B/C destination choice.
- [ ] Agent does not silently install Obsidian, enable CLI, edit PATH, elevate, overwrite, or delete.
- [ ] Agent writes an import receipt derived from the included template.
- [ ] Agent reports target Vault, target directory, copied/skipped/conflict counts, unresolved links, and receipt path.

## 8. GUI acceptance

Check Backup Center and Obsidian Export Center at 100%, 125%, and 150% browser zoom.

- [ ] Primary actions are visible without opening advanced sections.
- [ ] Schedule, diagnostics, logs, and detailed export parameters remain reachable.
- [ ] No clipped text, horizontal scrolling, hidden buttons, or unusable dropdowns.
- [ ] Keyboard focus is visible.
- [ ] Dangerous actions remain visually distinct.

## Result

Record each result as `PASS`, `FAIL`, or `BLOCKED`, with screenshot, exact step, expected result, actual result, Chrome version, operating system, and extension version. Do not mark this release externally accepted until all blocking items pass.
