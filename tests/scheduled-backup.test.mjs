import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileScheduledBackupAlarm,
  runScheduledBackupCycle,
} from "../apps/extension/src/scheduled-backup.js";
import {
  DEFAULT_SCHEDULE_SETTINGS,
  SCHEDULE_ALARM_NAME,
  SCHEDULE_CONTINUATION_ALARM_NAME,
  createScheduleRuntime,
} from "../apps/extension/src/scheduler-core.js";

function chromeMock({ tabs = [{ id: 7, active: true }], idle = "idle" } = {}) {
  const alarms = [];
  const cleared = [];
  const notifications = [];
  const badges = [];
  return {
    alarms,
    cleared,
    notifications,
    badges,
    api: {
      tabs: { async query() { return tabs; } },
      idle: { async queryState() { return idle; } },
      alarms: {
        async clear(name) { cleared.push(name); return true; },
        async create(name, options) { alarms.push({ name, ...options }); },
      },
      action: {
        async setBadgeBackgroundColor(value) { badges.push({ type: "color", value }); },
        async setBadgeText(value) { badges.push({ type: "text", value }); },
      },
      notifications: { async create(options) { notifications.push(options); return "notification"; } },
    },
  };
}

function snapshotStoreMock({ settings = {}, runtime = {}, lease = true } = {}) {
  let savedRuntime = createScheduleRuntime(runtime);
  const runs = [];
  const released = [];
  return {
    runs,
    released,
    async getSettings() { return { ...DEFAULT_SCHEDULE_SETTINGS, enabled: true, idleOnly: false, ...settings }; },
    async getRuntime() { return structuredClone(savedRuntime); },
    async saveRuntime(value) { savedRuntime = createScheduleRuntime(value); return structuredClone(savedRuntime); },
    async acquireLease(owner) { return lease ? { owner, token: "lease-token" } : null; },
    async releaseLease(value) { released.push(value); return true; },
    async recordRun(value) { runs.push(structuredClone(value)); return value; },
    async listSnapshots() { return []; },
    async listRuns() { return runs; },
    runtime() { return structuredClone(savedRuntime); },
  };
}

test("startup reconciliation schedules an overdue run immediately instead of skipping it", async () => {
  const now = new Date("2026-07-26T12:00:00Z");
  const chrome = chromeMock();
  const store = snapshotStoreMock({
    settings: { intervalDays: 3, localTime: "03:30" },
    runtime: { lastSuccessfulAt: "2026-07-20T12:00:00Z", nextRunAt: null },
  });
  await reconcileScheduledBackupAlarm({ chromeApi: chrome.api, snapshotStore: store, now });
  assert.equal(chrome.alarms.length, 1);
  assert.equal(chrome.alarms[0].name, SCHEDULE_ALARM_NAME);
  assert.equal(chrome.alarms[0].when, now.getTime() + 5_000);
});

test("scheduler defers while another backup owns the durable lease", async () => {
  const now = new Date("2026-07-26T12:00:00Z");
  const chrome = chromeMock();
  const store = snapshotStoreMock({ lease: false });
  const result = await runScheduledBackupCycle({ chromeApi: chrome.api, snapshotStore: store, historyStore: {}, now });
  assert.equal(result.status, "busy");
  assert.equal(chrome.alarms.at(-1).name, SCHEDULE_CONTINUATION_ALARM_NAME);
  assert.equal(store.runtime().status, "waiting_for_other_backup");
});

test("idle-only schedule defers without entering the backup engine", async () => {
  const now = new Date("2026-07-26T12:00:00Z");
  const chrome = chromeMock({ idle: "active" });
  const store = snapshotStoreMock({ settings: { idleOnly: true } });
  let called = false;
  const result = await runScheduledBackupCycle({
    chromeApi: chrome.api,
    snapshotStore: store,
    historyStore: {},
    now,
    runBackupEngine: async () => { called = true; },
  });
  assert.equal(result.status, "deferred");
  assert.equal(called, false);
  assert.equal(store.released.length, 1);
  assert.equal(store.runs[0].status, "deferred");
});

test("successful scheduled run creates one logical snapshot and records heartbeat progress", async () => {
  const now = new Date("2026-07-26T12:00:00Z");
  const chrome = chromeMock();
  const store = snapshotStoreMock({ settings: { assetPolicy: "references-only", notifyOnSuccess: true } });
  const historyStore = { async getLatestJob() { return { accountContext: { workspaceId: null, workspaceLabel: "个人空间" } }; } };
  let engineOptions;
  let snapshotCalls = 0;
  const result = await runScheduledBackupCycle({
    chromeApi: chrome.api,
    snapshotStore: store,
    historyStore,
    now,
    createTransport: () => ({ fake: true }),
    runBackupEngine: async (options) => {
      engineOptions = options;
      options.onProgress({ type: "conversation-complete", job: { status: "exporting", current: { phase: "exporting", index: 1, total: 2 }, stats: { completed: 1, indexed: 2 } } });
      return { id: "regular-history-v1", status: "completed", stats: { completed: 2, assetsDownloaded: 0 } };
    },
    createSnapshot: async () => {
      snapshotCalls += 1;
      return { created: true, snapshot: { id: "snapshot-1", stats: { conversations: 2, assets: 0 } } };
    },
  });
  assert.equal(result.status, "success");
  assert.equal(snapshotCalls, 1);
  assert.equal(engineOptions.assetPolicy, "references-only");
  assert.equal(engineOptions.refreshCompletedWithErrors, true);
  assert.equal(store.runtime().status, "success");
  assert.equal(store.runtime().lastResult.conversations, 2);
  assert.equal(store.released.length, 1);
  assert.equal(store.runs[0].status, "success");
  assert.ok(chrome.notifications.length >= 1);
  assert.equal(chrome.alarms.at(-1).name, SCHEDULE_ALARM_NAME);
});

test("time-sliced scheduled run saves a continuation checkpoint", async () => {
  const now = new Date("2026-07-26T12:00:00Z");
  const chrome = chromeMock();
  const store = snapshotStoreMock();
  const result = await runScheduledBackupCycle({
    chromeApi: chrome.api,
    snapshotStore: store,
    historyStore: { async getLatestJob() { return null; } },
    now,
    createTransport: () => ({}),
    runBackupEngine: async () => ({ id: "regular-history-v1", status: "paused", pauseReason: "scheduled-time-slice" }),
  });
  assert.equal(result.status, "partial");
  assert.equal(store.runtime().continuationPending, true);
  assert.equal(chrome.alarms.at(-1).name, SCHEDULE_CONTINUATION_ALARM_NAME);
  assert.equal(store.released.length, 1);
});
