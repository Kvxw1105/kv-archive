# KV Archive v0.16.4 — Ten-Minute Incremental Acceptance

v0.16.4 adds an isolated one-time acceptance mode for scheduled incremental backup. It lets a user verify the scheduler in ten minutes instead of waiting for the production daily or multi-day cadence.

## Flow

1. An existing logical snapshot is locked as the baseline.
2. A one-time Chrome Alarm is scheduled for ten minutes later.
3. The user creates a new ChatGPT conversation or edits an existing conversation during the window.
4. The alarm starts the real incremental backup path, even when the recurring schedule is disabled or idle-only mode would normally defer it.
5. Large accounts continue through the existing durable time-slice mechanism.
6. The baseline and latest logical snapshots are compared and the durable result becomes `passed_with_changes`, `passed_no_changes`, or `failed`.

## Safety boundaries

- No baseline means no test: the UI requires one immediate incremental run first.
- The test does not enable, disable, or change the recurring cadence.
- The test itself is a real browser-local backup and may update the last-success timestamp used by an already-enabled recurring schedule.
- It does not automatically download a ZIP; local export remains a separate explicit action.
- Test runtime, due time, baseline identity, alarm firing, result counts, and errors are stored durably.
- Pending alarms are reconciled after extension startup; active verification resumes through the existing continuation alarm.
- A waiting test can be cancelled. A backup already running cannot be destructively cancelled from this control.

## Evidence level

The alarm state machine and incremental comparison paths are locally verified with simulated time and the complete automated suite. A real installed Chrome profile with a logged-in ChatGPT tab is still required for external acceptance.
