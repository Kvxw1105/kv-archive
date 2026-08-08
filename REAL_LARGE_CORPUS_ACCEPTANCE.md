# Real large-corpus acceptance — v0.8.1

This check is optional until the user chooses to rerun the large backup.

1. Upgrade the same unpacked extension directory to v0.8.1 and click Reload.
2. Open Full backup and continue the existing task rather than clearing local data.
3. During collection, record whether phase, percentage, current item or heartbeat changes.
4. After collection, click Generate low-memory backup volumes.
5. Confirm only one volume is being generated/downloaded at a time.
6. Close the backup page after at least one completed volume, reopen it and confirm the remaining-volume count is preserved.
7. Continue and confirm completed volume numbers are skipped.
8. Extract all volumes into one directory and open `index.html`.
9. Compare conversation and attachment integrity totals with the backup screen.
10. Export the redacted acceptance diagnostic only when a specific item remains failed.

Pass criteria:

- Chromium remains usable and does not terminate the extension process.
- Collection reaches completed or completed-with-errors.
- No unexplained period is shown as zero progress without a heartbeat.
- All intended volumes are downloaded or can resume after interruption.
- Oversized/unsupported attachments are explicitly reported rather than causing a crash.
