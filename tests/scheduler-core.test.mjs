import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SCHEDULE_SETTINGS,
  computeDueRunAt,
  computeNextRunAt,
  computeRetryAt,
  createScheduleRuntime,
  normalizeLocalTime,
  normalizeScheduleSettings,
} from "../apps/extension/src/scheduler-core.js";

test("schedule settings normalize intervals, time, retention and asset policy", () => {
  const value = normalizeScheduleSettings({
    enabled: 1,
    intervalDays: 999,
    localTime: "27:99",
    idleSeconds: 1,
    assetPolicy: "unknown",
    maxAssetBytes: 999,
    retention: { maxSnapshots: 0, maxAgeDays: 99999 },
  });
  assert.equal(value.enabled, true);
  assert.equal(value.intervalDays, 365);
  assert.equal(value.localTime, "23:59");
  assert.equal(value.idleSeconds, 30);
  assert.equal(value.assetPolicy, DEFAULT_SCHEDULE_SETTINGS.assetPolicy);
  assert.equal(value.maxAssetBytes, 1024 * 1024);
  assert.equal(value.retention.maxSnapshots, 1);
  assert.equal(value.retention.maxAgeDays, 3650);
  assert.equal(normalizeLocalTime("not-a-time"), "03:30");
});

test("next run uses local wall-clock time and advances by the selected interval", () => {
  const now = new Date(2026, 6, 26, 10, 0, 0);
  const result = new Date(computeNextRunAt({ enabled: true, intervalDays: 3, localTime: "03:30" }, { now }));
  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 6);
  assert.equal(result.getDate(), 27);
  assert.equal(result.getHours(), 3);
  assert.equal(result.getMinutes(), 30);

  const lastSuccessfulAt = new Date(2026, 6, 25, 4, 0, 0);
  const next = new Date(computeNextRunAt(
    { enabled: true, intervalDays: 3, localTime: "03:30" },
    { now, lastSuccessfulAt },
  ));
  assert.equal(next.getDate(), 28);
  assert.equal(next.getHours(), 3);
});

test("due run preserves a missed occurrence so browser startup can catch it up", () => {
  const now = new Date(2026, 6, 26, 10, 0, 0);
  const lastSuccessfulAt = new Date(2026, 6, 20, 12, 0, 0);
  const due = new Date(computeDueRunAt(
    { enabled: true, intervalDays: 3, localTime: "03:30" },
    { now, lastSuccessfulAt },
  ));
  assert.equal(due.getDate(), 23);
  assert.equal(due.getHours(), 3);
  assert.ok(due.getTime() < now.getTime());
});

test("retry backoff is bounded and runtime carries durable heartbeat fields", () => {
  const now = Date.UTC(2026, 6, 26, 0, 0, 0);
  assert.equal(new Date(computeRetryAt(1, now)).getTime() - now, 15 * 60_000);
  assert.equal(new Date(computeRetryAt(2, now)).getTime() - now, 60 * 60_000);
  assert.equal(new Date(computeRetryAt(99, now)).getTime() - now, 24 * 60 * 60_000);
  const runtime = createScheduleRuntime();
  assert.equal(runtime.currentProgress, null);
  assert.equal(runtime.lastHeartbeatAt, null);
});
