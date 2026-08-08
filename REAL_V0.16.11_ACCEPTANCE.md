# Real Acceptance — KV Archive v0.16.11

Run this against the owner's existing data. Record observed results; local automation is evidence for the implementation, not a substitute for this acceptance.

## A. In-place Chrome upgrade and preservation

1. Export one important recovery/archive package as an extra safety copy and back up the currently loaded unpacked extension folder.
2. Upgrade in place using `INSTALL_v0.16.11.md`; keep the same loaded folder/extension identity and do not uninstall first.
3. Confirm extension version `0.16.11`.
4. Open Local Library, Capture, Project State, Memory and Backup Center; confirm existing data/settings remain available.
5. Read/export at least one conversation that was archived before v0.16.11.

PASS requires no migration prompt, no unexpected data loss and successful reading of a legacy whole-conversation artifact.

## B. Scheduler UI defect reproduction check

1. Open Backup Center → 定时增量备份.
2. Refresh status and interact with the 10-minute acceptance controls.
3. Observe the countdown/progress region.

PASS requires no `Cannot set properties of undefined (setting 'textContent')` message and visible/consistent countdown/progress state.

## C. Baseline and continued-conversation behavior

Use one existing ChatGPT conversation that can safely receive test turns. Keep a copy of its URL/title.

1. Ensure scheduled incremental is configured, then run `立即增量运行一次` to establish/refresh a logical snapshot.
2. Add one user message and receive one assistant reply in that same old conversation.
3. Run an incremental cycle (or use the 10-minute acceptance Alarm). Confirm `最近变化` reports that conversation as updated (`~1` when no other conversations changed).
4. Read/export the updated conversation and verify old + new turns and branch structure are intact.
5. Add a second user/assistant turn to the same conversation and run another incremental cycle.
6. Inspect `本轮复用节省` and the success detail.

Important upgrade expectation: if the selected conversation only exists in the v0.16.10 whole-object format, its first post-upgrade modification seeds v0.16.11 node/chunk objects and may show little or zero reuse. The second modification is the decisive reuse check.

PASS requires correct updated-conversation detection, lossless read/export and positive node/byte reuse on a subsequent v2-stored continuation.

## D. Snapshot history safety

1. Keep the pre-change and post-change logical snapshots during the test.
2. Confirm the newest conversation can be read after retention/refresh activity.
3. If testing snapshot deletion/retention, do it only in a disposable profile or after exporting a safety copy.

PASS requires no missing-content-object or missing-node dependency error.

## E. Scheduler lifecycle

1. Start the 10-minute acceptance mode.
2. Make a controlled conversation change during the waiting window.
3. Leave Chrome running and verify the Alarm-triggered cycle executes.
4. Separately test a missed schedule by closing Chrome across a scheduled time and reopening it later.

Record whether the precise Alarm and startup catch-up behave as designed. A real logged-in ChatGPT tab is required by the current browser architecture.

## F. Still outside this acceptance

- byte-perfect network-level message delta fetching (the updated raw graph is still fetched/hashed);
- Desktop background service independent of Chrome;
- Git commit/push/PR/CI;
- App Store/Play distribution;
- final integration with the separate note-app prototype.
