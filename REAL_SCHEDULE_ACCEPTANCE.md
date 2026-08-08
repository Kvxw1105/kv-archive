# ContextVault v0.9.0 Real Schedule Acceptance

Use this only when convenient; v0.9.0 does not require immediate manual testing to preserve local development status.

## Upgrade

1. Close open ContextVault backup/library/state pages.
2. Do not remove the old extension.
3. Replace files in the existing unpacked-extension directory.
4. Reload ContextVault in `chrome://extensions/` or `edge://extensions/`.
5. Keep one logged-in ChatGPT tab open.

## Quick acceptance

1. Open **Full Backup**.
2. Enable scheduled incremental backup.
3. Select the desired workspace, frequency, local time, and **References only** attachment policy.
4. Save.
5. Confirm a future next-run time is displayed.
6. Click **Run incrementally now**.
7. Confirm the status changes through running/continuation/success.
8. Refresh the page and confirm the latest snapshot count and delta remain.
9. Run again without changing ChatGPT content and confirm no duplicate snapshot is created.
10. Create or update one ChatGPT conversation, run again, and confirm only the changed/new conversation is downloaded and the snapshot delta changes.

## Catch-up acceptance

1. Configure a run within a few minutes.
2. Close the browser before that time.
3. Reopen the browser after the time has passed.
4. Keep a logged-in ChatGPT tab open.
5. Confirm ContextVault queues the missed occurrence instead of advancing past it.

## Evidence to retain if a problem occurs

- ContextVault version;
- schedule status text;
- last started/successful time;
- next run/retry time;
- current phase and counters;
- whether a logged-in ChatGPT tab was open;
- whether Chrome/Edge was fully closed;
- redacted error text.

Do not share cookies, authorization headers, access tokens, signed file URLs, or the raw browser profile.
