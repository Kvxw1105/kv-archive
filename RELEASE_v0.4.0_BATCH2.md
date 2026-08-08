# ContextVault v0.4.0 · Batch 2

## Main change

The history backup center now covers three source classes in one task:

- regular conversations;
- archived conversations;
- Projects and Project conversations.

The final delivery remains one ZIP with a searchable and filterable index.

## New capabilities

### Workspace-safe access

- Automatically reads the current ChatGPT session.
- Lists detected personal / Team workspaces.
- Lets the user choose the target workspace before backup.
- Keeps the temporary access token only in runtime memory.
- Locks the workspace after a job contains data.
- Rejects attempts to mix another workspace into an existing job.

### Unified recoverable job

- Job schema upgraded from version 1 to version 2.
- Existing v0.3.0 regular-history metadata and artifacts migrate in place when the extension ID is preserved.
- Already verified regular conversations are skipped.
- Paused jobs continue from their source and cursor state.
- Completed jobs can check for new or updated conversations.

### Complete source indexing

- Regular and archived lists have separate offsets and totals.
- Projects use catalog cursors.
- Each Project has its own conversation cursor and progress state.
- A failure in one conversation does not discard successful work.

### Source-aware archive

The ZIP now includes:

```text
index.html
manifest.json
projects.json
regular/
archived/
projects/
```

The index can filter by:

- all sources;
- regular;
- archived;
- all Projects;
- one specific Project.

## Important upgrade rule

To retain v0.3.0 IndexedDB progress, overwrite the files in the same unpacked-extension directory and click Reload in `chrome://extensions/` or `edge://extensions/`.

Removing the old extension and loading a new directory can produce a new extension ID, which isolates the old IndexedDB.

## Current boundary

Binary assets are not downloaded yet. Image, file and Project-file references remain preserved in raw JSON and Project metadata. Batch 3 will implement asset inventory, deduplication, download, verification, missing-file refetch and large-backup splitting.
