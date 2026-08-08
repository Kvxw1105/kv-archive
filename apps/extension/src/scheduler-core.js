export const SCHEDULE_ALARM_NAME = "context-vault-scheduled-backup";
export const SCHEDULE_CONTINUATION_ALARM_NAME = "context-vault-scheduled-backup-continuation";
export const SCHEDULE_TEST_ALARM_NAME = "context-vault-scheduled-backup-test";
export const SCHEDULE_SETTINGS_ID = "backup-schedule";
export const SCHEDULE_RUNTIME_ID = "backup-schedule-runtime";
export const SCHEDULE_TEST_RUNTIME_ID = "backup-schedule-test-runtime";
export const BACKUP_LEASE_ID = "backup-execution-lease";

export const DEFAULT_SCHEDULE_SETTINGS = Object.freeze({
  id: SCHEDULE_SETTINGS_ID,
  enabled: false,
  intervalDays: 3,
  localTime: "03:30",
  idleOnly: true,
  idleSeconds: 120,
  assetPolicy: "references-only",
  maxAssetBytes: 8 * 1024 * 1024,
  notifyOnSuccess: true,
  notifyOnFailure: true,
  retention: { maxSnapshots: 30, maxAgeDays: 180 },
  workspaceId: null,
  workspaceLabel: "个人空间",
  updatedAt: null,
});

function boundedInteger(value, fallback, min, max) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function normalizeLocalTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return DEFAULT_SCHEDULE_SETTINGS.localTime;
  const hours = boundedInteger(match[1], 3, 0, 23);
  const minutes = boundedInteger(match[2], 30, 0, 59);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function normalizeScheduleSettings(input = {}) {
  const retention = input.retention ?? {};
  const assetPolicy = ["references-only", "download"].includes(input.assetPolicy)
    ? input.assetPolicy
    : DEFAULT_SCHEDULE_SETTINGS.assetPolicy;
  return {
    ...DEFAULT_SCHEDULE_SETTINGS,
    ...input,
    id: SCHEDULE_SETTINGS_ID,
    enabled: Boolean(input.enabled),
    intervalDays: boundedInteger(input.intervalDays, DEFAULT_SCHEDULE_SETTINGS.intervalDays, 1, 365),
    localTime: normalizeLocalTime(input.localTime),
    idleOnly: input.idleOnly === undefined ? DEFAULT_SCHEDULE_SETTINGS.idleOnly : Boolean(input.idleOnly),
    idleSeconds: boundedInteger(input.idleSeconds, DEFAULT_SCHEDULE_SETTINGS.idleSeconds, 30, 3600),
    assetPolicy,
    maxAssetBytes: boundedInteger(input.maxAssetBytes, DEFAULT_SCHEDULE_SETTINGS.maxAssetBytes, 1024 * 1024, 64 * 1024 * 1024),
    notifyOnSuccess: input.notifyOnSuccess === undefined ? true : Boolean(input.notifyOnSuccess),
    notifyOnFailure: input.notifyOnFailure === undefined ? true : Boolean(input.notifyOnFailure),
    retention: {
      maxSnapshots: boundedInteger(retention.maxSnapshots, DEFAULT_SCHEDULE_SETTINGS.retention.maxSnapshots, 1, 365),
      maxAgeDays: boundedInteger(retention.maxAgeDays, DEFAULT_SCHEDULE_SETTINGS.retention.maxAgeDays, 1, 3650),
    },
    workspaceId: input.workspaceId ? String(input.workspaceId) : null,
    workspaceLabel: String(input.workspaceLabel || (input.workspaceId ? "选定工作空间" : "个人空间")),
    updatedAt: input.updatedAt || null,
  };
}

function localTarget(date, localTime) {
  const [hours, minutes] = normalizeLocalTime(localTime).split(":").map(Number);
  const target = new Date(date);
  target.setHours(hours, minutes, 0, 0);
  return target;
}

export function computeNextRunAt(settingsInput, options = {}) {
  const settings = normalizeScheduleSettings(settingsInput);
  if (!settings.enabled) return null;
  const now = new Date(options.now ?? Date.now());
  const lastSuccessfulAt = options.lastSuccessfulAt ? new Date(options.lastSuccessfulAt) : null;
  if (lastSuccessfulAt && Number.isFinite(lastSuccessfulAt.getTime())) {
    const target = localTarget(lastSuccessfulAt, settings.localTime);
    target.setDate(target.getDate() + settings.intervalDays);
    while (target.getTime() <= now.getTime()) target.setDate(target.getDate() + settings.intervalDays);
    return target.toISOString();
  }
  const target = localTarget(now, settings.localTime);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.toISOString();
}


export function computeDueRunAt(settingsInput, options = {}) {
  const settings = normalizeScheduleSettings(settingsInput);
  if (!settings.enabled) return null;
  const now = new Date(options.now ?? Date.now());
  const lastSuccessfulAt = options.lastSuccessfulAt ? new Date(options.lastSuccessfulAt) : null;
  if (!lastSuccessfulAt || !Number.isFinite(lastSuccessfulAt.getTime())) {
    return computeNextRunAt(settings, { now });
  }
  const target = localTarget(lastSuccessfulAt, settings.localTime);
  target.setDate(target.getDate() + settings.intervalDays);
  return target.toISOString();
}

export function computeRetryAt(failureCount = 1, now = Date.now()) {
  const delays = [15, 60, 6 * 60, 24 * 60];
  const minutes = delays[Math.min(delays.length - 1, Math.max(0, Number(failureCount) - 1))];
  return new Date(Number(now) + minutes * 60_000).toISOString();
}

export function isScheduleDue(runtime, now = Date.now()) {
  const target = runtime?.nextRunAt || runtime?.nextRetryAt;
  return Boolean(target && new Date(target).getTime() <= Number(now));
}

export function createScheduleTestRuntime(input = {}) {
  return {
    id: SCHEDULE_TEST_RUNTIME_ID,
    status: "idle",
    delayMinutes: 10,
    requestedAt: null,
    dueAt: null,
    baselineSnapshotId: null,
    baselineFingerprint: null,
    alarmFiredAt: null,
    verificationStartedAt: null,
    completedAt: null,
    latestSnapshotId: null,
    result: null,
    lastError: null,
    updatedAt: null,
    ...input,
    id: SCHEDULE_TEST_RUNTIME_ID,
  };
}

export function createScheduleRuntime(input = {}) {
  return {
    id: SCHEDULE_RUNTIME_ID,
    status: "idle",
    lastStartedAt: null,
    lastSuccessfulAt: null,
    lastCompletedAt: null,
    lastResult: null,
    lastError: null,
    failureCount: 0,
    nextRunAt: null,
    nextRetryAt: null,
    continuationPending: false,
    currentJobStatus: null,
    currentSnapshotId: null,
    currentPhase: null,
    currentProgress: null,
    lastHeartbeatAt: null,
    updatedAt: null,
    ...input,
    id: SCHEDULE_RUNTIME_ID,
  };
}
