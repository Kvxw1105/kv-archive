# Batch 4 Real-Browser Acceptance

This acceptance is optional for now because the user chose to continue development without pausing for manual testing.

## Upgrade

1. Keep the existing extension installed.
2. Replace the old extension-directory files with v0.6.0.
3. Open `chrome://extensions` or `edge://extensions`.
4. Select Reload for ContextVault.
5. Do not remove and reinstall from a different directory if old backup progress must remain available.

## ContextVault import

1. Open the extension and select `打开本地资料库`.
2. Select a ContextVault ZIP. For a split backup, select every volume in one file-picker operation.
3. Confirm the conversation, message, evidence and import counters increase.
4. Search for a phrase known to appear in an active response.
5. Search for a phrase known to appear in a regenerated historical response.
6. Apply Project, role, archive and date filters.
7. Open a result and confirm active and historical messages are labelled correctly.

## Official export import

1. Request and download an official OpenAI export.
2. Import the ZIP directly. Do not manually extract it first unless troubleshooting.
3. For larger exports, confirm numbered conversation JSON files are detected.
4. Re-import the same export and confirm the duplicate count increases without duplicating conversations.
5. Import an older export after a newer one and confirm current search results do not roll backward.

## Local-cache path

1. Open the full backup center.
2. With at least one locally saved conversation, select `加入本地资料库`.
3. Confirm the library opens and the newly indexed conversations are searchable.

## Failure checks

- An unrelated ZIP should produce a clear “no conversations found” error.
- A corrupted ZIP should produce a CRC or size error.
- An encrypted or ZIP64 archive should be rejected explicitly.
- Clearing the library should not clear the history-backup progress page.
