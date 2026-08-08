# Real Obsidian Acceptance — v0.11.0

This checklist is intentionally not marked passed by local Node tests. It requires the exported Vault to be opened in the real Obsidian desktop application.

## Preparation

1. Upgrade ContextVault in the same unpacked extension directory and reload it.
2. Open **Obsidian Knowledge Graph Export**.
3. Select a real Project with conversations, approved state and approved memory.
4. Start with **Standard**, **Full conversation**, and **24 MB** volumes.
5. Download every volume and extract all volumes into the same parent directory.
6. Open the resulting `ContextVault-Obsidian-<Project>` folder as an Obsidian Vault.

## Required checks

- [ ] `00 Home/ContextVault Home.md` opens.
- [ ] `00 Home/Project MOC.md` opens and its links resolve.
- [ ] Graph View contains Project, Conversation, Decision, Task, Memory and Evidence nodes expected from the source Project.
- [ ] No obvious duplicate managed nodes appear after a second export of unchanged data.
- [ ] A renamed conversation retains the same managed path after re-export.
- [ ] Backlinks show expected Project/conversation/decision relationships.
- [ ] YAML Properties parse without warnings and remain flat.
- [ ] `80 Canvas/Project Map.canvas` opens and all file cards resolve.
- [ ] Evidence URIs are visible in related Decision/Task/Memory notes.
- [ ] Search can find text from a full conversation note.
- [ ] Compact output remains readable and links remain valid.
- [ ] All volumes can be merged by extracting them into the same folder.
- [ ] Browser memory and UI remain responsive for the real Project.

## Failure evidence to capture

For every failure record:

- ContextVault version;
- Obsidian version and operating system;
- export options;
- Project conversation count;
- volume count and sizes;
- affected file path;
- exact error text;
- screenshot;
- whether the failure reproduces after a clean temporary Vault import.

## Explicit v0.11.0 boundary

The release does not directly modify an existing user Vault and does not copy arbitrary attachment binaries. Those capabilities require separate conflict and asset-path acceptance gates.


## Attachment materialization

1. Export a Project with **Include locally downloaded attachments** enabled.
2. Confirm `90 Attachments/` contains files that had previously been downloaded by ContextVault.
3. Open generated links and embedded images from Obsidian.
4. Confirm missing local assets are listed in the export report and are not represented by fabricated empty files.
5. Repeat with **Skip binaries** and confirm the export remains usable without attachment payloads.
