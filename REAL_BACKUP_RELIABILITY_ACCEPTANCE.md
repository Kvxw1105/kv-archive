# KV Archive v0.11.3 — Real Backup Reliability Acceptance

Use the existing Chrome profile and the same unpacked-extension directory whenever possible. Do not remove the old extension before upgrading, because removing an unpacked extension can also remove its browser-local database.

## A. Upgrade safely

1. Close open KV Archive pages.
2. Copy the current unpacked-extension folder as a safety backup.
3. Replace its files with the contents of the v0.11.3 extension package.
4. Open `chrome://extensions/` and click **Reload** on KV Archive.
5. Reopen the Backup Center.
6. Confirm that the existing 75% job and its counts are still visible.

## B. Recover the current paused job without downloading attachments

1. Keep one logged-in ChatGPT tab open in the same account/workspace used by the original job.
2. In **本次附件策略**, select **只备份对话，附件仅记录引用（推荐）**.
3. Click **继续备份**.
4. Expected result:
   - KV Archive reuses the durable checkpoint;
   - already stored conversations are not fetched again unnecessarily;
   - the job exits the attachment-download stage;
   - the final state says conversations are saved and attachment references are retained;
   - archive-volume generation becomes available.

Record whether the progress moves from 75% to completion and whether any login-expired message appears.

## C. Verify a true conversation-only run

1. After preserving the current backup and only when safe, start a small fresh job or use a test profile.
2. Keep the default conversation-only option.
3. Back up a small set containing at least one attachment reference.
4. Confirm:
   - conversation text is stored;
   - the attachment appears in inventory/reference metadata;
   - attachment downloaded count stays at zero;
   - no attachment binary is required for the job to complete;
   - the conversation can be added to and found in the local library.

## D. Verify optional attachment mode

1. Use a small test conversation with one accessible file and, where available, one expired/inaccessible file.
2. Select **同时下载可访问附件**.
3. Confirm:
   - accessible files are downloaded;
   - a stale signed URL is retried once with a renewed URL;
   - an inaccessible individual file is listed as failed/skipped;
   - the conversation backup remains available;
   - the whole job is not labelled logged out unless the session probe also fails.

## E. Regression checks

- Generate low-memory archive volumes.
- Add the backup to the local library.
- Search and open a known conversation.
- Confirm old snapshots and existing local attachments remain visible.
- Confirm scheduled backup still uses its own configured attachment policy.

## Feedback template

```text
KV Archive version: 0.11.3
Existing job or new job:
Selected attachment strategy:
Starting progress:
Ending progress:
Did it re-fetch old conversations:
Did it report login expired:
Attachment failures shown:
Final job status:
Screenshot / console error:
```
