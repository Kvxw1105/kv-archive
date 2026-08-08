# ContextVault v0.4.0 Real Account Acceptance

This checklist verifies only live ChatGPT behavior that cannot be reproduced in the build container.

## Preparation

1. Back up any important v0.3.0 ZIP already generated.
2. To preserve v0.3.0 progress, overwrite the same unpacked-extension directory with v0.4.0 files.
3. Open `chrome://extensions/` or `edge://extensions/` and click Reload.
4. Open ChatGPT and switch to the personal or Team workspace to be backed up.
5. Confirm that the account contains at least one regular conversation, one archived conversation and one Project if possible.

## Workspace detection

Expected:

- the backup center shows a workspace selector;
- personal and detected Team spaces are listed;
- an existing migrated job locks its original workspace;
- no token, Cookie or authorization string is shown in the UI or log.

Record:

- selected workspace label;
- whether the expected workspace appeared;
- whether the workspace was locked after progress existed.

## Index counts

Before running, note approximate UI counts for:

- regular conversations;
- archived conversations;
- Projects;
- conversations inside one known Project.

Run the backup and record the ContextVault counts.

Expected:

- regular and archived counts are separate;
- Projects count matches the visible Project list;
- Project-conversation count includes conversations under Projects;
- a conversation is not counted twice in the unique exported total even if multiple source references exist.

## Pause and continue

1. Pause while a Project is being indexed or a conversation is being saved.
2. Close the backup-center tab.
3. Reopen it from the extension.
4. Click Continue.

Expected:

- completed conversations are not fetched again;
- the current source and Project cursor continue;
- final counts do not reset.

## v0.3.0 migration

When an old job exists under the same extension ID:

Expected:

- the log reports a v0.3.0 migration notice;
- previously saved regular conversations remain completed;
- the new run begins with archived and Project indexing rather than re-downloading all regular conversations.

## Final ZIP

Expected one download only.

After extraction, verify:

```text
index.html
manifest.json
projects.json
regular/
archived/
projects/
```

Open `index.html` and test:

- title search;
- regular filter;
- archived filter;
- all Projects filter;
- one Project filter;
- opening at least one conversation from each available source.

Compare `manifest.json` counts with the backup-center counts.

## Failure reporting

Please capture exact text for any failure, especially:

- 401 / 403;
- 404 on Project endpoints;
- repeated cursor protection;
- empty Projects despite visible Projects;
- missing archived conversations;
- workspace selector missing the active Team space;
- downloaded ZIP count different from the displayed completed count.
