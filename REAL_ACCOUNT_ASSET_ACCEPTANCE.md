# Batch 3 Real-Account Asset Acceptance

Use ContextVault v0.5.1. The diagnostic report is designed to be safe to upload for debugging: it contains no conversation body, original title, original filename, token, cookie or signed download URL.

## Upgrade

1. Keep the same unpacked-extension directory used by v0.5.0.
2. Replace its files with v0.5.1.
3. Open `chrome://extensions/` or `edge://extensions/`.
4. Click **Reload** on ContextVault.
5. Do not remove the old extension first, otherwise Chromium may assign a new extension ID and lose the existing IndexedDB progress.

## Representative real-account matrix

Use non-sensitive test files where possible:

- one user-uploaded image;
- one PDF, Word or other document;
- one generated image / DALL-E asset, when available;
- one code-interpreter or tool-output file, when available;
- one Project-level file, when Projects are available;
- one file referenced by two conversations, when practical.

Unavailable kinds are recorded as **not exercised**, not fabricated as passing.

## Run

1. Keep a logged-in ChatGPT tab open in the target personal or Team workspace.
2. Open the ContextVault backup center.
3. Run **Start / Continue full backup**.
4. Confirm an interrupted asset download can resume without re-fetching completed conversations.
5. Confirm the generated ZIP opens and the local attachment links work.
6. Click **Export privacy-safe acceptance report**.
7. Upload the resulting `ContextVault-Acceptance-Diagnostic-YYYY-MM-DD.html` to the development conversation.

## Automatic acceptance report

The report includes:

- extension and task version;
- personal/workspace mode without exposing workspace ID;
- conversation and asset counts;
- observed and unexercised asset kinds;
- expected and actual bytes;
- duplicate reference count;
- per-asset alias, type, MIME, extension, state and byte counts;
- selected signed-file endpoint label;
- binary response status and download host;
- classified failures and blockers.

The report explicitly excludes:

- ChatGPT conversation text;
- original conversation titles;
- original filenames;
- access tokens and Authorization headers;
- cookies;
- signed download URLs;
- raw conversation IDs, Project IDs, workspace IDs and file IDs.

## Exit decision

- `passed: true`: all discovered downloadable assets were saved and there are no unsupported or missing references. Review coverage kinds before closing Batch 3.
- `passed: false`: upload the report. Fix the classified defects, reload the patch and rerun only failed items.
