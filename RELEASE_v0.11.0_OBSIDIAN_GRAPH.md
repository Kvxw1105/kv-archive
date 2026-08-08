# ContextVault v0.11.0 — Obsidian Knowledge Graph Export

v0.11.0 turns one ContextVault Project into a plugin-free Obsidian Vault package.

## Added

- provider-neutral KnowledgeGraphIR;
- Project, Conversation, Decision, Task, Memory and Evidence graph nodes;
- stable typed relations and evidence links;
- flat YAML Properties;
- Obsidian wiki links and Backlink-ready notes;
- ContextVault Home and Project MOC;
- curated JSON Canvas project map;
- stable managed paths across title changes;
- manifest, path map, quality report and volume metadata;
- Standard/Compact structure modes;
- Full/Compact conversation modes;
- 12/24/48 MB target volume settings;
- bounded-memory sequential export;
- pause after current volume and persisted resume state;
- database schema v8 for export profiles, paths and runs.

## How to use

1. Open ContextVault and choose **Obsidian Knowledge Graph Export**.
2. Select one Project and analyze it.
3. Confirm that the quality report has no broken graph or Canvas references.
4. Generate every ZIP volume.
5. Extract every volume into the same parent folder.
6. Open the resulting `ContextVault-Obsidian-<Project>` folder as an Obsidian Vault.
7. Open Graph View or `80 Canvas/Project Map.canvas`.

## Upgrade

Do not remove the existing unpacked extension. Replace the files in the same extension directory and click **Reload** in `chrome://extensions/` or `edge://extensions/`. IndexedDB upgrades from schema v7 to v8 without deleting prior data.

## Boundaries

- one Project per export;
- no direct write into an existing Vault;
- no automatic user-note overwrite or deletion;
- no community plugin requirement;
- no model/API token use;
- no automatic concept-node explosion;
- attachment binary copying is not part of this release;
- real Obsidian desktop acceptance is still required.
