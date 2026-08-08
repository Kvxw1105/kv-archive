import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelScheduledBackupTest,
  handleScheduledBackupAlarm,
  reconcileScheduledBackupAlarm,
  startScheduledBackupTest,
} from "../apps/extension/src/scheduled-backup.js";
import {
  DEFAULT_SCHEDULE_SETTINGS,
  SCHEDULE_CONTINUATION_ALARM_NAME,
  SCHEDULE_TEST_ALARM_NAME,
  createScheduleRuntime,
  createScheduleTestRuntime,
} from "../apps/extension/src/scheduler-core.js";

const baselineSnapshot = {
  id: "snapshot-baseline",
  jobId: "regular-history-v1",
  accountKey: "personal",
  fingerprint: "baseline-fingerprint",
  createdAt: "2026-07-30T14:00:00.000Z",
  conversations: [{ conversationId: "c1", objectKey: "conversation:c1:v1", locations: [{ type: "regular", present: true }] }],
  assets: [],
  projects: [],
  stats: { conversations: 1, assets: 0 },
};

function chromeMock({ tabs = [{ id: 7, active: true }] } = {}) {
  const alarms = [];
  const cleared = [];
  return {
    alarms,
    cleared,
    api: {
      tabs: { async query() { return tabs; } },
      idle: { async queryState() { return "active"; } },
      alarms: {
        async clear(name) { cleared.push(name); return true; },
        async create(name, options) { alarms.push({ name, ...options }); },
      },
      action: {
        async setBadgeBackgroundColor() {},
        async setBadgeText() {},
      },
      notifications: { async create() { return "notice"; } },
    },
  };
}

function snapshotStoreMock({ snapshots = [baselineSnapshot], settings = {}, testRuntime = {}, runtime = {} } = {}) {
  let rows = structuredClone(snapshots);
  let savedRuntime = createScheduleRuntime(runtime);
  let savedTestRuntime = createScheduleTestRuntime(testRuntime);
  const runs = [];
  return {
    runs,
    async getSettings() { return { ...DEFAULT_SCHEDULE_SETTINGS, enabled: false, idleOnly: true, ...settings }; },
    async getRuntime() { return structuredClone(savedRuntime); },
    async saveRuntime(value) { savedRuntime = createScheduleRuntime(value); return structuredClone(savedRuntime); },
    async getTestRuntime() { return structuredClone(savedTestRuntime); },
    async saveTestRuntime(value) { savedTestRuntime = createScheduleTestRuntime(value); return structuredClone(savedTestRuntime); },
    async acquireLease(owner) { return { owner, token: "test-lease" }; },
    async releaseLease() { return true; },
    async recordRun(value) { runs.push(structuredClone(value)); return value; },
    async listRuns() { return structuredClone(runs); },
    async listSnapshots({ jobId = null, accountKey = null } = {}) {
      return rows
        .filter((item) => (!jobId || item.jobId === jobId) && (!accountKey || item.accountKey === accountKey))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map((item) => structuredClone(item));
    },
    async getSnapshot(id) { return structuredClone(rows.find((item) => item.id === id) ?? null); },
    replaceSnapshots(next) { rows = structuredClone(next); },
    testRuntime() { return structuredClone(savedTestRuntime); },
  };
}

function historyStoreMock() {
  return {
    async getLatestJob() {
      return { id: "regular-history-v1", accountContext: { workspaceId: null, workspaceLabel: "个人空间" } };
    },
  };
}

test("10-minute acceptance schedules one exact alarm from an existing baseline", async () => {
  const now = new Date("2026-07-30T14:00:00.000Z");
  const chrome = chromeMock();
  const store = snapshotStoreMock();
  const result = await startScheduledBackupTest({
    chromeApi: chrome.api,
    snapshotStore: store,
    historyStore: historyStoreMock(),
    delayMinutes: 10,
    now,
  });
  assert.equal(result.status, "waiting");
  assert.equal(store.testRuntime().baselineSnapshotId, baselineSnapshot.id);
  assert.equal(store.testRuntime().dueAt, "2026-07-30T14:10:00.000Z");
  const alarm = chrome.alarms.find((item) => item.name === SCHEDULE_TEST_ALARM_NAME);
  assert.equal(alarm.when, now.getTime() + 10 * 60_000);
});

test("10-minute acceptance refuses to claim incremental verification without a baseline", async () => {
  const chrome = chromeMock();
  const store = snapshotStoreMock({ snapshots: [] });
  const result = await startScheduledBackupTest({
    chromeApi: chrome.api,
    snapshotStore: store,
    historyStore: historyStoreMock(),
    delayMinutes: 10,
    now: new Date("2026-07-30T14:00:00.000Z"),
  });
  assert.equal(result.status, "baseline_required");
  assert.equal(store.testRuntime().status, "baseline_required");
  assert.equal(chrome.alarms.some((item) => item.name === SCHEDULE_TEST_ALARM_NAME), false);
});

test("test alarm runs the real incremental path and records added and updated conversations", async () => {
  const chrome = chromeMock();
  const store = snapshotStoreMock({ testRuntime: {
    status: "waiting",
    requestedAt: "2026-07-30T14:00:00.000Z",
    dueAt: "2026-07-30T14:10:00.000Z",
    baselineSnapshotId: baselineSnapshot.id,
    baselineFingerprint: baselineSnapshot.fingerprint,
  } });
  const changed = {
    ...baselineSnapshot,
    id: "snapshot-changed",
    fingerprint: "changed-fingerprint",
    createdAt: "2026-07-30T14:10:10.000Z",
    previousSnapshotId: baselineSnapshot.id,
    conversations: [
      { conversationId: "c1", objectKey: "conversation:c1:v2", locations: [{ type: "regular", present: true }] },
      { conversationId: "c2", objectKey: "conversation:c2:v1", locations: [{ type: "regular", present: true }] },
    ],
  };
  const result = await handleScheduledBackupAlarm({ name: SCHEDULE_TEST_ALARM_NAME }, {
    chromeApi: chrome.api,
    snapshotStore: store,
    historyStore: historyStoreMock(),
    now: new Date("2026-07-30T14:10:00.000Z"),
    createTransport: () => ({}),
    runBackupEngine: async () => ({ id: "regular-history-v1", status: "completed", stats: { completed: 2, assetsDownloaded: 0 } }),
    createSnapshot: async () => {
      store.replaceSnapshots([changed, baselineSnapshot]);
      return { created: true, snapshot: changed };
    },
  });
  assert.equal(result.status, "success");
  assert.equal(store.testRuntime().status, "passed_with_changes");
  assert.equal(store.testRuntime().result.changes.conversations.added, 1);
  assert.equal(store.testRuntime().result.changes.conversations.updated, 1);
  assert.equal(store.testRuntime().result.alarmTriggered, true);
});

test("test alarm distinguishes a successful automatic check with no content changes", async () => {
  const chrome = chromeMock();
  const store = snapshotStoreMock({ testRuntime: {
    status: "waiting",
    requestedAt: "2026-07-30T14:00:00.000Z",
    dueAt: "2026-07-30T14:10:00.000Z",
    baselineSnapshotId: baselineSnapshot.id,
    baselineFingerprint: baselineSnapshot.fingerprint,
  } });
  const result = await handleScheduledBackupAlarm({ name: SCHEDULE_TEST_ALARM_NAME }, {
    chromeApi: chrome.api,
    snapshotStore: store,
    historyStore: historyStoreMock(),
    now: new Date("2026-07-30T14:10:00.000Z"),
    createTransport: () => ({}),
    runBackupEngine: async () => ({ id: "regular-history-v1", status: "completed", stats: { completed: 1, assetsDownloaded: 0 } }),
    createSnapshot: async () => ({ created: false, unchanged: true, snapshot: baselineSnapshot }),
  });
  assert.equal(result.status, "success");
  assert.equal(store.testRuntime().status, "passed_no_changes");
  assert.equal(store.testRuntime().result.snapshotChanged, false);
  assert.equal(store.testRuntime().result.changes.total, 0);
});

test("startup reconciliation recreates a pending test alarm and waiting tests remain cancellable", async () => {
  const now = new Date("2026-07-30T14:02:00.000Z");
  const chrome = chromeMock();
  const store = snapshotStoreMock({ testRuntime: {
    status: "waiting",
    requestedAt: "2026-07-30T14:00:00.000Z",
    dueAt: "2026-07-30T14:10:00.000Z",
    baselineSnapshotId: baselineSnapshot.id,
  } });
  await reconcileScheduledBackupAlarm({ chromeApi: chrome.api, snapshotStore: store, now });
  assert.ok(chrome.alarms.some((item) => item.name === SCHEDULE_TEST_ALARM_NAME));
  const cancelled = await cancelScheduledBackupTest({ chromeApi: chrome.api, snapshotStore: store, now });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(store.testRuntime().status, "cancelled");
  assert.ok(chrome.cleared.includes(SCHEDULE_TEST_ALARM_NAME));

  await store.saveTestRuntime({
    ...store.testRuntime(),
    status: "waiting_for_completion",
    alarmFiredAt: "2026-07-30T14:10:00.000Z",
  });
  await reconcileScheduledBackupAlarm({ chromeApi: chrome.api, snapshotStore: store, now });
  assert.ok(chrome.alarms.some((item) => item.name === SCHEDULE_CONTINUATION_ALARM_NAME));
});
