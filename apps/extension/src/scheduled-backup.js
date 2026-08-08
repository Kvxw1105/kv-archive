import { compareLogicalSnapshots, createLogicalSnapshot } from "./content-snapshots.js";
import { createChatGPTTransport } from "./history-api.js";
import { DEFAULT_HISTORY_JOB_ID, runUnifiedHistoryBackup } from "./history-engine.js";
import { createIndexedDbHistoryStore } from "./history-store.js";
import {
  SCHEDULE_ALARM_NAME,
  SCHEDULE_CONTINUATION_ALARM_NAME,
  SCHEDULE_TEST_ALARM_NAME,
  computeDueRunAt,
  computeNextRunAt,
  computeRetryAt,
  createScheduleRuntime,
  createScheduleTestRuntime,
  normalizeScheduleSettings,
} from "./scheduler-core.js";
import { createIndexedDbSnapshotStore } from "./snapshot-store.js";

const DEFAULT_SLICE_MS = 24_000;
const DEFAULT_TEST_DELAY_MINUTES = 10;
const CONTINUATION_DELAY_MS = 60_000;
const BUSY_RETRY_MS = 5 * 60_000;
const HEARTBEAT_INTERVAL_MS = 3_000;

function cleanError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/Bearer\s+\S+/gi, "Bearer <redacted>")
    .replace(/https?:\/\/[^\s\"'<>]+/gi, "<redacted-url>")
    .slice(0, 500);
}

async function invokeChrome(fn, ...args) {
  if (typeof fn !== "function") return undefined;
  return await fn(...args);
}

async function queryChatGPTTab(chromeApi) {
  const tabs = await invokeChrome(chromeApi.tabs?.query?.bind(chromeApi.tabs), {
    url: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  }) ?? [];
  return tabs.find((tab) => tab.active) ?? tabs[0] ?? null;
}

async function queryIdleState(chromeApi, idleSeconds) {
  if (!chromeApi.idle?.queryState) return "unknown";
  return await invokeChrome(chromeApi.idle.queryState.bind(chromeApi.idle), idleSeconds);
}

async function setBadge(chromeApi, text, color) {
  if (chromeApi.action?.setBadgeBackgroundColor) {
    await invokeChrome(chromeApi.action.setBadgeBackgroundColor.bind(chromeApi.action), { color }).catch(() => {});
  }
  if (chromeApi.action?.setBadgeText) {
    await invokeChrome(chromeApi.action.setBadgeText.bind(chromeApi.action), { text }).catch(() => {});
  }
}

async function notify(chromeApi, title, message) {
  if (!chromeApi.notifications?.create) return;
  await invokeChrome(chromeApi.notifications.create.bind(chromeApi.notifications), {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message: String(message).slice(0, 500),
  }).catch(() => {});
}

async function clearAlarm(chromeApi, name) {
  if (!chromeApi.alarms?.clear) return false;
  return await invokeChrome(chromeApi.alarms.clear.bind(chromeApi.alarms), name).catch(() => false);
}

async function createAlarm(chromeApi, name, when, clock = Date.now()) {
  if (!chromeApi.alarms?.create || !when) return;
  await clearAlarm(chromeApi, name);
  const requested = new Date(when).getTime();
  if (!Number.isFinite(requested)) throw new Error(`无效的定时任务时间：${when}`);
  await invokeChrome(
    chromeApi.alarms.create.bind(chromeApi.alarms),
    name,
    { when: Math.max(Number(clock) + 5_000, requested) },
  );
}

function normalizeTestDelayMinutes(value) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(60, Math.max(1, parsed)) : DEFAULT_TEST_DELAY_MINUTES;
}

function isActiveTestRuntime(runtime) {
  return ["waiting", "running", "waiting_for_completion"].includes(runtime?.status);
}

function countSnapshotChanges(delta) {
  const category = (value = {}) => ({
    added: value.added?.length ?? 0,
    updated: value.updated?.length ?? 0,
    removed: value.removed?.length ?? 0,
    unchanged: value.unchanged ?? 0,
  });
  const conversations = category(delta?.conversations);
  const assets = category(delta?.assets);
  const projects = category(delta?.projects);
  const total = conversations.added + conversations.updated + conversations.removed
    + assets.added + assets.updated + assets.removed
    + projects.added + projects.updated + projects.removed;
  return { conversations, assets, projects, total };
}

function chooseAlarmTarget(runtime) {
  const retryMs = runtime.nextRetryAt ? new Date(runtime.nextRetryAt).getTime() : Number.POSITIVE_INFINITY;
  const runMs = runtime.nextRunAt ? new Date(runtime.nextRunAt).getTime() : Number.POSITIVE_INFINITY;
  if (retryMs <= runMs) return { name: SCHEDULE_CONTINUATION_ALARM_NAME, when: runtime.nextRetryAt };
  return { name: SCHEDULE_ALARM_NAME, when: runtime.nextRunAt };
}

async function readTestRuntime(snapshotStore) {
  if (typeof snapshotStore.getTestRuntime !== "function") return createScheduleTestRuntime();
  return createScheduleTestRuntime(await snapshotStore.getTestRuntime());
}

async function writeTestRuntime(snapshotStore, runtime) {
  const value = createScheduleTestRuntime(runtime);
  if (typeof snapshotStore.saveTestRuntime !== "function") return value;
  return snapshotStore.saveTestRuntime(value);
}

export async function reconcileScheduledBackupTestAlarm({
  chromeApi = chrome,
  snapshotStore = createIndexedDbSnapshotStore(),
  now = new Date(),
} = {}) {
  const testRuntime = await readTestRuntime(snapshotStore);
  await clearAlarm(chromeApi, SCHEDULE_TEST_ALARM_NAME);
  if (testRuntime.status === "waiting" && testRuntime.dueAt) {
    await createAlarm(chromeApi, SCHEDULE_TEST_ALARM_NAME, testRuntime.dueAt, now.getTime());
  } else if (["running", "waiting_for_completion"].includes(testRuntime.status) && testRuntime.alarmFiredAt) {
    await createAlarm(chromeApi, SCHEDULE_CONTINUATION_ALARM_NAME, new Date(now.getTime() + 5_000).toISOString(), now.getTime());
  }
  return testRuntime;
}

export async function startScheduledBackupTest({
  chromeApi = chrome,
  snapshotStore = createIndexedDbSnapshotStore(),
  historyStore = createIndexedDbHistoryStore(),
  delayMinutes = DEFAULT_TEST_DELAY_MINUTES,
  now = new Date(),
} = {}) {
  const current = await readTestRuntime(snapshotStore);
  if (isActiveTestRuntime(current)) return { status: "already_running", testRuntime: current };
  const currentJob = await historyStore.getLatestJob(DEFAULT_HISTORY_JOB_ID).catch(() => null);
  const currentAccountKey = currentJob?.accountContext?.workspaceId || "personal";
  const snapshots = await snapshotStore.listSnapshots({ jobId: DEFAULT_HISTORY_JOB_ID, accountKey: currentAccountKey });
  const baseline = snapshots[0] ?? null;
  const normalizedDelay = normalizeTestDelayMinutes(delayMinutes);
  if (!baseline) {
    const testRuntime = await writeTestRuntime(snapshotStore, {
      status: "baseline_required",
      delayMinutes: normalizedDelay,
      requestedAt: now.toISOString(),
      dueAt: null,
      baselineSnapshotId: null,
      baselineFingerprint: null,
      alarmFiredAt: null,
      verificationStartedAt: null,
      completedAt: now.toISOString(),
      latestSnapshotId: null,
      result: null,
      lastError: null,
    });
    return { status: "baseline_required", testRuntime };
  }
  const dueAt = new Date(now.getTime() + normalizedDelay * 60_000).toISOString();
  const testRuntime = await writeTestRuntime(snapshotStore, {
    status: "waiting",
    delayMinutes: normalizedDelay,
    requestedAt: now.toISOString(),
    dueAt,
    baselineSnapshotId: baseline.id,
    baselineFingerprint: baseline.fingerprint ?? null,
    alarmFiredAt: null,
    verificationStartedAt: null,
    completedAt: null,
    latestSnapshotId: baseline.id,
    result: null,
    lastError: null,
  });
  await createAlarm(chromeApi, SCHEDULE_TEST_ALARM_NAME, dueAt, now.getTime());
  return { status: "waiting", testRuntime };
}

export async function cancelScheduledBackupTest({
  chromeApi = chrome,
  snapshotStore = createIndexedDbSnapshotStore(),
  now = new Date(),
} = {}) {
  const current = await readTestRuntime(snapshotStore);
  if (["running", "waiting_for_completion"].includes(current.status)) {
    return { status: "cannot_cancel_running", testRuntime: current };
  }
  if (current.status !== "waiting") return { status: current.status, testRuntime: current };
  await clearAlarm(chromeApi, SCHEDULE_TEST_ALARM_NAME);
  const testRuntime = await writeTestRuntime(snapshotStore, {
    ...current,
    status: "cancelled",
    completedAt: now.toISOString(),
    lastError: null,
  });
  return { status: "cancelled", testRuntime };
}

async function markTestWaitingForCompletion(snapshotStore, now = new Date()) {
  const current = await readTestRuntime(snapshotStore);
  if (!isActiveTestRuntime(current)) return current;
  return writeTestRuntime(snapshotStore, {
    ...current,
    status: "waiting_for_completion",
    alarmFiredAt: current.alarmFiredAt ?? now.toISOString(),
    verificationStartedAt: current.verificationStartedAt ?? now.toISOString(),
    lastError: null,
  });
}

async function failActiveScheduleTest(snapshotStore, error, now = new Date()) {
  const current = await readTestRuntime(snapshotStore);
  if (!isActiveTestRuntime(current)) return current;
  return writeTestRuntime(snapshotStore, {
    ...current,
    status: "failed",
    completedAt: now.toISOString(),
    lastError: cleanError(error),
  });
}

async function finalizeActiveScheduleTest(snapshotStore, now = new Date()) {
  const current = await readTestRuntime(snapshotStore);
  if (!isActiveTestRuntime(current)) return current;
  const baseline = current.baselineSnapshotId && typeof snapshotStore.getSnapshot === "function"
    ? await snapshotStore.getSnapshot(current.baselineSnapshotId)
    : null;
  if (!baseline) return failActiveScheduleTest(snapshotStore, "找不到 10 分钟验收的基线快照", now);
  const snapshots = await snapshotStore.listSnapshots({ jobId: baseline.jobId, accountKey: baseline.accountKey });
  const latest = snapshots[0] ?? baseline;
  const delta = compareLogicalSnapshots(baseline, latest);
  const changes = countSnapshotChanges(delta);
  const status = changes.total > 0 ? "passed_with_changes" : "passed_no_changes";
  return writeTestRuntime(snapshotStore, {
    ...current,
    status,
    completedAt: now.toISOString(),
    latestSnapshotId: latest.id,
    result: {
      alarmTriggered: true,
      baselineSnapshotId: baseline.id,
      latestSnapshotId: latest.id,
      snapshotChanged: baseline.id !== latest.id,
      changes,
    },
    lastError: null,
  });
}

export async function reconcileScheduledBackupAlarm({
  chromeApi = chrome,
  snapshotStore = createIndexedDbSnapshotStore(),
  now = new Date(),
} = {}) {
  const settings = normalizeScheduleSettings(await snapshotStore.getSettings());
  let runtime = createScheduleRuntime(await snapshotStore.getRuntime());
  await Promise.all([
    clearAlarm(chromeApi, SCHEDULE_ALARM_NAME),
    clearAlarm(chromeApi, SCHEDULE_CONTINUATION_ALARM_NAME),
  ]);
  if (!settings.enabled) {
    runtime = await snapshotStore.saveRuntime({
      ...runtime, nextRunAt: null, nextRetryAt: null, continuationPending: false, status: "disabled",
    });
  } else {
    if (!runtime.nextRunAt) {
      runtime.nextRunAt = runtime.lastSuccessfulAt
        ? computeDueRunAt(settings, { now, lastSuccessfulAt: runtime.lastSuccessfulAt })
        : computeNextRunAt(settings, { now });
      runtime.status = runtime.status === "disabled" ? "idle" : runtime.status;
      runtime = await snapshotStore.saveRuntime(runtime);
    }
    const target = chooseAlarmTarget(runtime);
    await createAlarm(chromeApi, target.name, target.when, now.getTime());
  }
  const testRuntime = await reconcileScheduledBackupTestAlarm({ chromeApi, snapshotStore, now });
  return { settings, runtime, testRuntime };
}

export async function saveScheduledBackupSettings(settingsInput, options = {}) {
  const snapshotStore = options.snapshotStore ?? createIndexedDbSnapshotStore();
  const settings = await snapshotStore.saveSettings(settingsInput);
  let runtime = createScheduleRuntime(await snapshotStore.getRuntime());
  runtime.nextRetryAt = null;
  runtime.failureCount = 0;
  runtime.continuationPending = false;
  runtime.nextRunAt = settings.enabled
    ? computeNextRunAt(settings, { now: options.now ?? new Date(), lastSuccessfulAt: runtime.lastSuccessfulAt })
    : null;
  runtime.status = settings.enabled ? "idle" : "disabled";
  runtime = await snapshotStore.saveRuntime(runtime);
  const reconciled = await reconcileScheduledBackupAlarm({ chromeApi: options.chromeApi ?? chrome, snapshotStore, now: options.now ?? new Date() });
  return { settings, runtime, testRuntime: reconciled.testRuntime };
}

export async function getScheduledBackupStatus(options = {}) {
  const snapshotStore = options.snapshotStore ?? createIndexedDbSnapshotStore();
  const historyStore = options.historyStore ?? createIndexedDbHistoryStore();
  const currentJob = await historyStore.getLatestJob(DEFAULT_HISTORY_JOB_ID).catch(() => null);
  const currentAccountKey = currentJob?.accountContext?.workspaceId || "personal";
  const [settings, runtime, testRuntime, snapshots, runs] = await Promise.all([
    snapshotStore.getSettings(),
    snapshotStore.getRuntime(),
    readTestRuntime(snapshotStore),
    snapshotStore.listSnapshots({ jobId: DEFAULT_HISTORY_JOB_ID, accountKey: currentAccountKey }),
    snapshotStore.listRuns(20),
  ]);
  return { settings, runtime, testRuntime, snapshotCount: snapshots.length, snapshots: snapshots.slice(0, 20), runs };
}

function progressSummary(event) {
  const job = event?.job;
  if (!job) return null;
  return {
    type: event.type ?? null,
    status: job.status ?? null,
    current: job.current ? {
      phase: job.current.phase ?? null,
      index: Number(job.current.index ?? 0),
      total: Number(job.current.total ?? 0),
      source: job.current.source ?? null,
    } : null,
    completed: Number(job.stats?.completed ?? 0),
    indexed: Number(job.stats?.indexed ?? 0),
    assetsDownloaded: Number(job.stats?.assetsDownloaded ?? 0),
    assetsDiscovered: Number(job.stats?.assetsDiscovered ?? 0),
  };
}

export async function runScheduledBackupCycle({
  chromeApi = chrome,
  historyStore = createIndexedDbHistoryStore(),
  snapshotStore = createIndexedDbSnapshotStore(),
  reason = "alarm",
  now = new Date(),
  sliceMs = DEFAULT_SLICE_MS,
  runBackupEngine = runUnifiedHistoryBackup,
  createSnapshot = createLogicalSnapshot,
  createTransport = createChatGPTTransport,
} = {}) {
  const settings = normalizeScheduleSettings(await snapshotStore.getSettings());
  const isTestRun = reason === "test" || reason === "test-continuation";
  const bypassScheduleGuards = reason === "manual" || isTestRun;
  if (!settings.enabled && !bypassScheduleGuards) return { status: "disabled" };
  const owner = `scheduler:${reason}`;
  const lease = await snapshotStore.acquireLease(owner, Math.max(2 * 60_000, sliceMs + 60_000), now.getTime());
  if (!lease) {
    const runtime = await snapshotStore.saveRuntime({
      ...(await snapshotStore.getRuntime()),
      status: "waiting_for_other_backup",
      nextRetryAt: new Date(now.getTime() + BUSY_RETRY_MS).toISOString(),
    });
    await createAlarm(chromeApi, SCHEDULE_CONTINUATION_ALARM_NAME, runtime.nextRetryAt, now.getTime());
    if (isTestRun) await markTestWaitingForCompletion(snapshotStore, now);
    return { status: "busy", runtime };
  }

  const runId = `scheduled-${now.toISOString().replace(/[:.]/g, "-")}`;
  let runtime = createScheduleRuntime(await snapshotStore.getRuntime());
  runtime = await snapshotStore.saveRuntime({
    ...runtime,
    status: "running",
    lastStartedAt: now.toISOString(),
    lastError: null,
    continuationPending: false,
    nextRetryAt: null,
    lastHeartbeatAt: now.toISOString(),
  });
  await setBadge(chromeApi, "AUTO", "#315846");
  const control = { paused: false, reason: "scheduled-time-slice" };
  const timer = setTimeout(() => { control.paused = true; }, Math.max(5_000, sliceMs));
  let runStatus = "failed";
  let job = null;
  let lastHeartbeat = 0;
  let heartbeatChain = Promise.resolve();
  const heartbeat = (event, force = false) => {
    const timestamp = Date.now();
    if (!force && timestamp - lastHeartbeat < HEARTBEAT_INTERVAL_MS) return;
    lastHeartbeat = timestamp;
    const summary = progressSummary(event);
    if (!summary) return;
    runtime.currentJobStatus = summary.status;
    runtime.currentPhase = summary.current?.phase ?? summary.type;
    runtime.currentProgress = summary;
    runtime.lastHeartbeatAt = new Date(timestamp).toISOString();
    const snapshot = { ...runtime };
    heartbeatChain = heartbeatChain
      .then(() => snapshotStore.saveRuntime(snapshot))
      .then((saved) => { runtime = saved; })
      .catch(() => {});
  };

  try {
    if (settings.idleOnly && !bypassScheduleGuards) {
      const idleState = await queryIdleState(chromeApi, settings.idleSeconds);
      if (idleState === "active") {
        const nextRetryAt = new Date(now.getTime() + 15 * 60_000).toISOString();
        runtime = await snapshotStore.saveRuntime({ ...runtime, status: "waiting_for_idle", nextRetryAt });
        await createAlarm(chromeApi, SCHEDULE_CONTINUATION_ALARM_NAME, nextRetryAt, now.getTime());
        runStatus = "deferred";
        return { status: "deferred", reason: "browser-active", runtime };
      }
    }
    const tab = await queryChatGPTTab(chromeApi);
    if (!tab?.id) throw new Error("未找到已登录的 ChatGPT 标签页；自动备份将在稍后补跑。");
    const existing = await historyStore.getLatestJob(DEFAULT_HISTORY_JOB_ID);
    const workspaceId = existing?.accountContext?.workspaceId ?? settings.workspaceId ?? null;
    const workspaceLabel = existing?.accountContext?.workspaceLabel ?? settings.workspaceLabel ?? "个人空间";
    const transport = createTransport(tab.id, { workspaceId, workspaceLabel });
    job = await runBackupEngine({
      store: historyStore,
      transport,
      control,
      requestDelayMs: 120,
      assetPolicy: settings.assetPolicy,
      maxAssetBytes: settings.maxAssetBytes,
      refreshCompletedWithErrors: true,
      onProgress: (event) => heartbeat(event),
    });
    heartbeat({ job, type: "slice-complete" }, true);
    await heartbeatChain;
    if (job.status === "paused" && job.pauseReason === "scheduled-time-slice") {
      const nextRetryAt = new Date(Date.now() + CONTINUATION_DELAY_MS).toISOString();
      runtime = await snapshotStore.saveRuntime({
        ...runtime,
        status: "continuation_pending",
        continuationPending: true,
        currentJobStatus: job.status,
        nextRetryAt,
      });
      await createAlarm(chromeApi, SCHEDULE_CONTINUATION_ALARM_NAME, nextRetryAt);
      if (isTestRun) await markTestWaitingForCompletion(snapshotStore, new Date());
      runStatus = "partial";
      return { status: "partial", job, runtime };
    }
    if (job.status !== "completed" && job.status !== "completed_with_errors") {
      throw new Error(`自动备份未达到可创建快照的状态：${job.status}`);
    }
    const snapshotResult = await createSnapshot({
      historyStore, snapshotStore, job,
      source: isTestRun ? "scheduled-test" : reason === "manual" ? "scheduled-manual" : "scheduled",
      createdAt: new Date(), retention: settings.retention, runId,
    });
    const completedAt = new Date().toISOString();
    runtime = await snapshotStore.saveRuntime({
      ...runtime,
      status: job.status === "completed" ? "success" : "success_with_warnings",
      lastSuccessfulAt: completedAt,
      lastCompletedAt: completedAt,
      lastResult: {
        jobStatus: job.status, snapshotCreated: snapshotResult.created,
        snapshotId: snapshotResult.snapshot?.id ?? null,
        conversations: snapshotResult.snapshot?.stats?.conversations ?? job.stats?.completed ?? 0,
        assets: snapshotResult.snapshot?.stats?.assets ?? job.stats?.assetsDownloaded ?? 0,
      },
      currentSnapshotId: snapshotResult.snapshot?.id ?? runtime.currentSnapshotId,
      failureCount: 0, nextRetryAt: null, continuationPending: false,
      nextRunAt: computeNextRunAt(settings, { now: new Date(), lastSuccessfulAt: completedAt }),
      currentJobStatus: job.status, currentPhase: null, currentProgress: null,
      lastHeartbeatAt: completedAt,
    });
    await Promise.all([
      clearAlarm(chromeApi, SCHEDULE_CONTINUATION_ALARM_NAME),
      createAlarm(chromeApi, SCHEDULE_ALARM_NAME, runtime.nextRunAt),
    ]);
    if (settings.notifyOnSuccess) {
      await notify(chromeApi, "ContextVault 自动备份完成", snapshotResult.created
        ? `已创建增量快照，保存 ${snapshotResult.snapshot.stats.conversations} 条对话。`
        : "没有发现内容变化，未重复创建快照。");
    }
    const activeTest = await readTestRuntime(snapshotStore);
    const testRuntime = isTestRun || activeTest.status === "waiting_for_completion"
      ? await finalizeActiveScheduleTest(snapshotStore, new Date())
      : activeTest;
    runStatus = "success";
    return { status: "success", job, snapshotResult, runtime, testRuntime };
  } catch (error) {
    await heartbeatChain;
    const failureCount = Number(runtime.failureCount ?? 0) + 1;
    const nextRetryAt = isTestRun ? null : computeRetryAt(failureCount, Date.now());
    runtime = await snapshotStore.saveRuntime({
      ...runtime, status: "failed", lastError: cleanError(error), failureCount, nextRetryAt,
      continuationPending: false, currentJobStatus: job?.status ?? runtime.currentJobStatus,
    });
    if (nextRetryAt) await createAlarm(chromeApi, SCHEDULE_CONTINUATION_ALARM_NAME, nextRetryAt);
    if (isTestRun) await failActiveScheduleTest(snapshotStore, error, new Date());
    if (settings.notifyOnFailure) await notify(chromeApi, isTestRun ? "ContextVault 10 分钟增量验收失败" : "ContextVault 自动备份延期", isTestRun ? runtime.lastError : `${runtime.lastError} 下次将自动重试。`);
    await setBadge(chromeApi, "!", "#7d3030");
    return { status: "failed", error: runtime.lastError, runtime };
  } finally {
    clearTimeout(timer);
    await heartbeatChain;
    await snapshotStore.recordRun({
      id: runId, reason, status: runStatus, startedAt: now.toISOString(),
      completedAt: new Date().toISOString(), jobStatus: job?.status ?? null,
      error: runStatus === "failed" ? runtime.lastError : null,
    }).catch(() => {});
    await snapshotStore.releaseLease(lease).catch(() => {});
    if (runStatus !== "failed") await setBadge(chromeApi, runStatus === "success" ? "OK" : "…", runStatus === "success" ? "#315846" : "#81651e");
  }
}

export async function runScheduledBackupTestVerification(options = {}) {
  const snapshotStore = options.snapshotStore ?? createIndexedDbSnapshotStore();
  const now = options.now ?? new Date();
  const current = await readTestRuntime(snapshotStore);
  if (current.status !== "waiting") return { status: current.status, testRuntime: current };
  await writeTestRuntime(snapshotStore, {
    ...current,
    status: "running",
    alarmFiredAt: now.toISOString(),
    verificationStartedAt: now.toISOString(),
    completedAt: null,
    lastError: null,
  });
  const result = await runScheduledBackupCycle({ ...options, snapshotStore, reason: "test", sliceMs: options.sliceMs ?? 45_000 });
  if (["partial", "busy"].includes(result.status)) {
    const testRuntime = await markTestWaitingForCompletion(snapshotStore, new Date());
    return { ...result, testRuntime };
  }
  return { ...result, testRuntime: await readTestRuntime(snapshotStore) };
}

export async function handleScheduledBackupAlarm(alarm, options = {}) {
  if (alarm?.name === SCHEDULE_TEST_ALARM_NAME) return runScheduledBackupTestVerification(options);
  if (![SCHEDULE_ALARM_NAME, SCHEDULE_CONTINUATION_ALARM_NAME].includes(alarm?.name)) return null;
  if (alarm.name === SCHEDULE_CONTINUATION_ALARM_NAME) {
    const snapshotStore = options.snapshotStore ?? createIndexedDbSnapshotStore();
    const testRuntime = await readTestRuntime(snapshotStore);
    const reason = testRuntime.status === "waiting_for_completion" && testRuntime.alarmFiredAt
      ? "test-continuation"
      : "continuation";
    return runScheduledBackupCycle({ ...options, snapshotStore, reason });
  }
  return runScheduledBackupCycle({ ...options, reason: "alarm" });
}
