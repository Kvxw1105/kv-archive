import { createChatGPTTransport } from "./history-api.js";
import { DEFAULT_HISTORY_JOB_ID, runUnifiedHistoryBackup } from "./history-engine.js";
import { createIndexedDbHistoryStore } from "./history-store.js";
import { buildLowMemoryHistoryArchiveVolume, createLowMemoryHistoryArchivePlan } from "./history-archive.js";
import { buildAcceptanceDiagnostic, renderAcceptanceDiagnosticHtml } from "./acceptance-diagnostic.js";
import { createIndexedDbLibraryStore } from "./library-store.js";
import { importCandidatesIntoVault } from "./vault-import.js";
import { normalizeChatGPTConversation } from "./packages/normalizer/src/index.js";
import { computeBackupProgress } from "./backup-progress.js";
import { createLogicalSnapshot } from "./content-snapshots.js";
import { createIndexedDbSnapshotStore } from "./snapshot-store.js";
import { buildBackupPreflight, classifyRecoveryAction, deriveBackupHealth } from "./ux-guidance.js";
import { createTaskFeedback } from "./task-feedback.js";

const store = createIndexedDbHistoryStore();
const libraryStore = createIndexedDbLibraryStore();
const snapshotStore = createIndexedDbSnapshotStore();
const backupControl = { paused: false };
const archiveControl = { paused: false };
const MAX_LOG_ROWS = 120;
const DEVICE_MEMORY_GB = Number(navigator.deviceMemory || 8);
const ARCHIVE_VOLUME_BYTES = (DEVICE_MEMORY_GB <= 4 ? 12 : 24) * 1024 * 1024;
const SAFE_MAX_ASSET_BYTES = (DEVICE_MEMORY_GB <= 4 ? 16 : 32) * 1024 * 1024;
const RENDER_INTERVAL_MS = 300;

let activeBackup = null;
let activeArchive = null;
let chatgptTab = null;
let pendingRenderJob = null;
let renderTimer = null;
let lastProgressAt = Date.now();
let archiveProgress = null;
let successCounters = { conversations: 0, assets: 0 };
let manualLease = null;
let manualLeaseHeartbeat = null;
let storageStatus = { usage: 0, quota: 0, persisted: false };
let latestHealth = null;
let lastRecovery = null;
let preflightReady = false;
let latestSchedulePayload = null;
let scheduleTestPollTimer = null;
let scheduleTestCountdownTimer = null;
let latestScheduleTestRuntime = null;

const ids = [
  "connection", "workspace", "workspace-help", "regular", "archived", "projects",
  "project-conversations", "completed", "assets-discovered", "assets-downloaded",
  "asset-failed", "asset-mb", "failed", "retries", "archive-volumes", "phase",
  "current-title", "percent", "bar", "status", "start", "pause", "download",
  "restart-download", "diagnostic", "library", "reset", "log", "clear-log",
  "manual-assets",
  "schedule-enabled", "schedule-frequency", "schedule-time", "schedule-assets",
  "schedule-retention-count", "schedule-retention-days", "schedule-idle", "schedule-next",
  "schedule-last", "schedule-snapshots", "schedule-delta", "schedule-dedup", "schedule-state", "schedule-message",
  "schedule-save", "schedule-run", "schedule-refresh",
  "schedule-test-state", "schedule-test-due", "schedule-test-result", "schedule-test-message",
  "schedule-test-countdown", "schedule-test-progress", "schedule-test-progress-bar", "schedule-test-progress-label",
  "schedule-test-start", "schedule-test-cancel",
  "backup-health", "health-title", "health-detail", "health-browser", "health-computer", "health-storage", "health-persisted", "health-action", "metrics-summary",
  "backup-recovery-actions", "recovery-primary", "recovery-secondary",
  "preflight-panel", "preflight-close", "preflight-cancel", "preflight-confirm", "preflight-workspace", "preflight-conversations", "preflight-projects", "preflight-assets", "preflight-storage", "preflight-note",
];
const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const taskFeedback = createTaskFeedback({ page: "BACKUP CENTER" });
const progressAnchor = document.querySelector(".progress-card");
const stamp = () => new Date().toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
const isCompleted = (job) => job?.status === "completed" || job?.status === "completed_with_errors";
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

export function boundedLogAppend(list, message, timeText = stamp(), maxRows = MAX_LOG_ROWS) {
  if (!list) return;
  const li = document.createElement("li");
  const time = document.createElement("time");
  time.textContent = timeText;
  li.append(time, document.createTextNode(message));
  list.prepend(li);
  while (list.children.length > maxRows) list.lastElementChild?.remove();
}

function addLog(message) {
  boundedLogAppend(elements.log, message);
}

function setStatus(message, tone = "") {
  elements.status.textContent = message;
  elements.status.dataset.tone = tone;
}

async function readStorageStatus({ requestPersist = false } = {}) {
  try {
    const estimate = await navigator.storage?.estimate?.() ?? {};
    let persisted = await navigator.storage?.persisted?.() ?? false;
    if (requestPersist && !persisted && navigator.storage?.persist) persisted = await navigator.storage.persist();
    storageStatus = { usage: Number(estimate.usage ?? 0), quota: Number(estimate.quota ?? 0), persisted: Boolean(persisted) };
  } catch {
    storageStatus = { usage: 0, quota: 0, persisted: false };
  }
  return storageStatus;
}

function renderBackupHealth(job) {
  latestHealth = deriveBackupHealth(job, storageStatus);
  elements["backup-health"].dataset.tone = latestHealth.tone;
  elements["health-title"].textContent = latestHealth.title;
  elements["health-detail"].textContent = latestHealth.detail;
  elements["health-browser"].textContent = latestHealth.browserState;
  elements["health-computer"].textContent = latestHealth.computerState;
  elements["health-storage"].textContent = latestHealth.storageState;
  elements["health-persisted"].textContent = latestHealth.persisted ? "已启用" : "未确认";
  elements["health-action"].textContent = latestHealth.nextAction;
}

function clearRecovery() {
  lastRecovery = null;
  elements["backup-recovery-actions"].hidden = true;
}

function showRecovery(error) {
  lastRecovery = classifyRecoveryAction(error);
  elements["recovery-primary"].textContent = lastRecovery.label;
  elements["recovery-secondary"].textContent = lastRecovery.secondaryLabel;
  elements["backup-recovery-actions"].hidden = false;
}

function runtimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error || "KV Archive 后台操作失败"));
      resolve(response);
    });
  });
}

function formatDateTime(value, fallback = "尚无") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : fallback;
}


function formatBytes(value) {
  const bytes = Math.max(0, Number(value ?? 0) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function scheduleStateLabel(status) {
  return ({
    disabled: "未启用", idle: "等待计划时间", running: "正在增量备份",
    waiting_for_idle: "等待浏览器空闲", waiting_for_other_backup: "等待其他备份结束",
    continuation_pending: "已保存检查点，等待继续", success: "上次运行成功",
    success_with_warnings: "成功，但有待处理项", failed: "上次运行失败",
  })[status] || status || "未知";
}

function scheduleTestStateLabel(status) {
  return ({
    idle: "未启动", baseline_required: "需要基线", waiting: "等待自动触发",
    running: "正在自动增量", waiting_for_completion: "后台续跑中",
    passed_with_changes: "通过：检测到变化", passed_no_changes: "通过：无内容变化",
    failed: "验收失败", cancelled: "已取消",
  })[status] || status || "未启动";
}


function formatCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateScheduleTestCountdown() {
  const runtime = latestScheduleTestRuntime || {};
  const status = runtime.status || "idle";
  const dueMs = runtime.dueAt ? new Date(runtime.dueAt).getTime() : NaN;
  const requestedMs = runtime.requestedAt ? new Date(runtime.requestedAt).getTime() : NaN;
  const countdown = elements["schedule-test-countdown"];
  const progress = elements["schedule-test-progress"];
  const bar = elements["schedule-test-progress-bar"];
  const label = elements["schedule-test-progress-label"];
  if (!countdown || !progress || !bar || !label) return;
  if (status === "waiting" && Number.isFinite(dueMs)) {
    const now = Date.now();
    const remaining = Math.max(0, dueMs - now);
    const duration = Number.isFinite(requestedMs) ? Math.max(1, dueMs - requestedMs) : Math.max(1, Number(runtime.delayMinutes || 10) * 60_000);
    const percent = Math.max(0, Math.min(100, ((duration - remaining) / duration) * 100));
    countdown.textContent = formatCountdown(remaining);
    progress.hidden = false;
    bar.style.width = `${percent.toFixed(1)}%`;
    label.textContent = `等待自动触发 · ${formatCountdown(remaining)} · ${Math.round(percent)}%`;
  } else if (["running", "waiting_for_completion"].includes(status)) {
    countdown.textContent = "已触发";
    progress.hidden = false;
    bar.style.width = "100%";
    label.textContent = status === "running" ? "Alarm 已触发，正在扫描和比较" : "后台分片续跑中";
  } else {
    countdown.textContent = runtime.completedAt ? "已结束" : "尚无";
    progress.hidden = true;
    bar.style.width = "0%";
    label.textContent = "等待开始";
  }
}

function renderScheduleTest(testRuntime = {}, snapshotCount = 0) {
  latestScheduleTestRuntime = testRuntime;
  const status = testRuntime.status || "idle";
  const active = ["waiting", "running", "waiting_for_completion"].includes(status);
  const changes = testRuntime.result?.changes;
  const conversations = changes?.conversations;
  elements["schedule-test-state"].textContent = scheduleTestStateLabel(status);
  elements["schedule-test-due"].textContent = formatDateTime(testRuntime.dueAt, "尚无");
  updateScheduleTestCountdown();
  elements["schedule-test-result"].textContent = changes
    ? `会话 +${conversations?.added ?? 0} · ~${conversations?.updated ?? 0} · −${conversations?.removed ?? 0}`
    : status === "passed_no_changes" ? "自动运行成功，内容无变化" : "尚无";
  let message = "需要至少一份逻辑快照作为比较基线。测试期间可以关闭 KV Archive 页面，但应保持 Chrome 运行并保留一个已登录 ChatGPT 标签页。";
  let tone = "";
  if (status === "baseline_required") {
    message = "当前没有逻辑快照。请先点击“立即增量运行一次”完成基线，再开始 10 分钟验收。";
    tone = "warning";
  } else if (status === "waiting") {
    message = `基线已锁定。请在 ${formatDateTime(testRuntime.dueAt)} 前后新建或编辑一条 ChatGPT 会话；页面可以关闭，但 Chrome 与登录标签页应保持运行。`;
    tone = "warning";
  } else if (status === "running") {
    message = "Chrome Alarm 已触发，正在自动读取并比较增量。";
    tone = "warning";
  } else if (status === "waiting_for_completion") {
    message = "自动增量任务已保存检查点，正在后台分片续跑。";
    tone = "warning";
  } else if (status === "passed_with_changes") {
    message = `验收通过：自动任务已触发，并检测到 ${changes?.total ?? 0} 项变化。`;
    tone = "success";
  } else if (status === "passed_no_changes") {
    message = "验收通过：Chrome Alarm 与自动增量读取均成功，但基线之后没有检测到内容变化。";
    tone = "success";
  } else if (status === "failed") {
    message = `验收失败：${testRuntime.lastError || "未知错误"}`;
    tone = "error";
  } else if (status === "cancelled") {
    message = "本次待运行验收已取消，基线快照和既有定时设置均未删除。";
  } else if (snapshotCount > 0) {
    message = "已有逻辑快照，可以开始 10 分钟自动增量验收。";
  }
  elements["schedule-test-message"].textContent = message;
  elements["schedule-test-message"].dataset.tone = tone;
  elements["schedule-test-start"].disabled = active;
  elements["schedule-test-cancel"].disabled = status !== "waiting";
  if (active && !scheduleTestPollTimer) {
    scheduleTestPollTimer = setInterval(() => { void loadScheduleStatus(); }, 5_000);
  } else if (!active && scheduleTestPollTimer) {
    clearInterval(scheduleTestPollTimer);
    scheduleTestPollTimer = null;
  }
  if (status === "waiting" && !scheduleTestCountdownTimer) scheduleTestCountdownTimer = setInterval(updateScheduleTestCountdown, 1_000);
  if (status !== "waiting" && scheduleTestCountdownTimer) { clearInterval(scheduleTestCountdownTimer); scheduleTestCountdownTimer = null; }
}

function renderScheduleStatus(payload) {
  latestSchedulePayload = payload;
  const settings = payload?.settings ?? {};
  const runtime = payload?.runtime ?? {};
  elements["schedule-enabled"].checked = Boolean(settings.enabled);
  elements["schedule-frequency"].value = String(settings.intervalDays ?? 3);
  elements["schedule-time"].value = settings.localTime || "03:30";
  elements["schedule-assets"].value = settings.assetPolicy || "references-only";
  elements["schedule-retention-count"].value = String(settings.retention?.maxSnapshots ?? 30);
  elements["schedule-retention-days"].value = String(settings.retention?.maxAgeDays ?? 180);
  elements["schedule-idle"].checked = settings.idleOnly !== false;
  elements["schedule-next"].textContent = settings.enabled ? formatDateTime(runtime.nextRetryAt || runtime.nextRunAt, "等待计算") : "未启用";
  elements["schedule-last"].textContent = formatDateTime(runtime.lastSuccessfulAt);
  elements["schedule-snapshots"].textContent = String(payload?.snapshotCount ?? payload?.snapshots?.length ?? 0);
  const latestSnapshot = payload?.snapshots?.[0] ?? null;
  const conversationDelta = latestSnapshot?.delta?.conversations ?? {};
  const added = conversationDelta.added?.length ?? 0;
  const updated = conversationDelta.updated?.length ?? 0;
  const removed = conversationDelta.removed?.length ?? 0;
  elements["schedule-delta"].textContent = `+${added} · ~${updated} · −${removed}`;
  elements["schedule-dedup"].textContent = formatBytes(latestSnapshot?.stats?.incrementalBytesReused ?? latestSnapshot?.stats?.dedupSavedBytes ?? 0);
  elements["schedule-state"].textContent = scheduleStateLabel(runtime.status);
  const last = runtime.lastResult;
  const progress = runtime.currentProgress;
  const detail = runtime.lastError
    ? `上次错误：${runtime.lastError}`
    : runtime.status === "running" && progress
      ? `正在执行 ${progress.current?.phase || progress.type || "增量任务"}：${progress.current?.index ?? progress.completed ?? 0}/${progress.current?.total ?? progress.indexed ?? 0}；已保存 ${progress.completed ?? 0} 条对话。`
      : runtime.status === "continuation_pending" && progress
        ? `当前切片已保存检查点：已保存 ${progress.completed ?? 0}/${progress.indexed ?? 0} 条对话，稍后自动继续。`
        : last
          ? `上次处理 ${last.conversations ?? 0} 条对话；${last.snapshotCreated ? "已创建新快照" : "内容未变化，未重复创建快照"}${Number(latestSnapshot?.stats?.incrementalBytesReused ?? 0) > 0 ? `；复用 ${latestSnapshot.stats.incrementalNodesReused ?? 0} 个旧会话节点，避免重复写入约 ${formatBytes(latestSnapshot.stats.incrementalBytesReused)}` : ""}。`
          : "定时任务尚未运行。";
  elements["schedule-message"].textContent = detail;
  elements["schedule-message"].dataset.tone = runtime.lastError ? "error" : runtime.status?.startsWith("success") ? "success" : "";
  renderScheduleTest(payload?.testRuntime ?? {}, payload?.snapshotCount ?? payload?.snapshots?.length ?? 0);
}

async function loadScheduleStatus() {
  try {
    const payload = await runtimeMessage({ type: "context-vault-schedule-get" });
    renderScheduleStatus(payload);
    return payload;
  } catch (error) {
    elements["schedule-message"].textContent = error instanceof Error ? error.message : String(error);
    elements["schedule-message"].dataset.tone = "error";
    return null;
  }
}

async function saveScheduleSettings() {
  elements["schedule-save"].disabled = true;
  taskFeedback.start({ title: "正在保存定时设置", detail: "正在写入周期、时间、附件和保留策略。", stage: "保存自动化配置", step: 1, button: elements["schedule-save"], buttonLabel: "正在保存…" });
  try {
    const selected = elements.workspace.selectedOptions?.[0];
    const payload = await runtimeMessage({
      type: "context-vault-schedule-save",
      settings: {
        enabled: elements["schedule-enabled"].checked,
        intervalDays: Number(elements["schedule-frequency"].value),
        localTime: elements["schedule-time"].value,
        idleOnly: elements["schedule-idle"].checked,
        assetPolicy: elements["schedule-assets"].value,
        maxAssetBytes: SAFE_MAX_ASSET_BYTES,
        workspaceId: elements.workspace.value || null,
        workspaceLabel: selected?.textContent || "个人空间",
        retention: {
          maxSnapshots: Number(elements["schedule-retention-count"].value),
          maxAgeDays: Number(elements["schedule-retention-days"].value),
        },
      },
    });
    renderScheduleStatus(payload);
    elements["schedule-message"].textContent = payload.settings.enabled
      ? `定时增量备份已启用，下次运行：${formatDateTime(payload.runtime.nextRunAt)}。`
      : "定时增量备份已关闭，既有快照不会被删除。";
    elements["schedule-message"].dataset.tone = "success";
    taskFeedback.success({ title: "定时设置已保存", detail: elements["schedule-message"].textContent, button: elements["schedule-save"] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    elements["schedule-message"].textContent = message;
    elements["schedule-message"].dataset.tone = "error";
    taskFeedback.fail({ title: "定时设置未保存", detail: message, button: elements["schedule-save"] });
  } finally {
    elements["schedule-save"].disabled = false;
  }
}

async function runScheduleNow() {
  elements["schedule-run"].disabled = true;
  elements["schedule-message"].textContent = "正在启动增量任务。单次后台切片最多约 45 秒，未完成会自动续跑。";
  taskFeedback.start({ title: "正在运行增量备份", detail: elements["schedule-message"].textContent, stage: "启动后台任务", step: 0, button: elements["schedule-run"], buttonLabel: "增量运行中…", indeterminate: true, autoStages: [{ after: 1500, stage: "扫描新增与变更", detail: "正在比较逻辑快照，只读取新增或已更新的会话。", step: 1 }, { after: 6000, stage: "保存检查点", detail: "长任务会分片续跑，已完成内容会先落盘。", step: 2 }] });
  elements["schedule-message"].dataset.tone = "warning";
  try {
    const result = await runtimeMessage({ type: "context-vault-schedule-run-now" });
    await loadScheduleStatus();
    elements["schedule-message"].textContent = result.status === "success"
      ? "本次增量任务已完成。"
      : result.status === "partial"
        ? "本次切片已保存检查点，后台会继续处理剩余内容。"
        : result.status === "busy"
          ? "已有备份任务正在运行，定时任务已排队。"
          : result.error || `任务状态：${result.status}`;
    elements["schedule-message"].dataset.tone = result.status === "success" ? "success" : result.status === "failed" ? "error" : "warning";
    if (result.status === "failed") taskFeedback.fail({ title: "增量备份未完成", detail: elements["schedule-message"].textContent, button: elements["schedule-run"] });
    else if (["partial", "busy"].includes(result.status)) taskFeedback.pause({ title: "增量任务已保存状态", detail: elements["schedule-message"].textContent, stage: result.status === "busy" ? "等待其他任务" : "后台续跑中", button: elements["schedule-run"] });
    else taskFeedback.success({ title: "增量备份已完成", detail: elements["schedule-message"].textContent, button: elements["schedule-run"] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    elements["schedule-message"].textContent = message;
    elements["schedule-message"].dataset.tone = "error";
    taskFeedback.fail({ title: "增量备份启动失败", detail: message, button: elements["schedule-run"] });
  } finally {
    elements["schedule-run"].disabled = false;
  }
}

async function startTenMinuteScheduleTest() {
  elements["schedule-test-start"].disabled = true;
  elements["schedule-test-message"].textContent = "正在锁定基线并创建 10 分钟 Chrome Alarm…";
  taskFeedback.start({ title: "正在启动 10 分钟验收", detail: elements["schedule-test-message"].textContent, stage: "锁定基线快照", step: 0, button: elements["schedule-test-start"], buttonLabel: "正在启动…", progress: 20, indeterminate: false });
  elements["schedule-test-message"].dataset.tone = "warning";
  try {
    const result = await runtimeMessage({ type: "context-vault-schedule-test-start", delayMinutes: 10 });
    await loadScheduleStatus();
    if (result.status === "baseline_required") {
      elements["schedule-test-message"].textContent = "还没有逻辑快照。请先点击“立即增量运行一次”，完成后再开始验收。";
      elements["schedule-test-message"].dataset.tone = "warning";
      taskFeedback.pause({ title: "验收需要先建立基线", detail: elements["schedule-test-message"].textContent, stage: "等待基线", button: elements["schedule-test-start"] });
    } else {
      taskFeedback.success({ title: "10 分钟验收已排程", detail: `将在 ${formatDateTime(result.dueAt || latestSchedulePayload?.testRuntime?.dueAt)} 自动触发。`, button: elements["schedule-test-start"] });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    elements["schedule-test-message"].textContent = message;
    elements["schedule-test-message"].dataset.tone = "error";
    taskFeedback.fail({ title: "验收未能启动", detail: message, button: elements["schedule-test-start"] });
  } finally {
    const active = ["waiting", "running", "waiting_for_completion"].includes(latestSchedulePayload?.testRuntime?.status);
    elements["schedule-test-start"].disabled = active;
  }
}

async function cancelTenMinuteScheduleTest() {
  elements["schedule-test-cancel"].disabled = true;
  try {
    await runtimeMessage({ type: "context-vault-schedule-test-cancel" });
    await loadScheduleStatus();
  } catch (error) {
    elements["schedule-test-message"].textContent = error instanceof Error ? error.message : String(error);
    elements["schedule-test-message"].dataset.tone = "error";
  }
}

async function acquireManualLease(owner) {
  const lease = await snapshotStore.acquireLease(owner, 12 * 60_000);
  if (!lease) throw new Error("另一个自动或手动备份任务正在运行，请等待其保存检查点后再试。");
  manualLease = lease;
  manualLeaseHeartbeat = setInterval(() => {
    void snapshotStore.renewLease(lease, 12 * 60_000).catch(() => {});
  }, 2 * 60_000);
  return lease;
}

async function releaseManualLease() {
  if (manualLeaseHeartbeat) clearInterval(manualLeaseHeartbeat);
  manualLeaseHeartbeat = null;
  const lease = manualLease;
  manualLease = null;
  if (lease) await snapshotStore.releaseLease(lease).catch(() => {});
}

function phaseLabel(job) {
  if (archiveProgress) {
    if (archiveProgress.phase === "planning") return "正在规划低内存分卷";
    if (archiveProgress.phase === "building") return "正在生成低内存分卷";
    if (archiveProgress.phase === "downloading") return "正在等待分卷下载";
    if (archiveProgress.phase === "paused") return "分卷生成已暂停";
  }
  return ({
    idle: "尚未开始",
    indexing: "正在建立全量索引",
    exporting: "正在保存对话",
    asset_indexing: "正在扫描附件",
    asset_downloading: "对话已完成，正在下载附件",
    paused: "已暂停，可继续",
    completed: "本地采集完成",
    completed_with_errors: "本地采集完成，但有待处理项",
    failed: "备份中断",
  })[job?.status] ?? job?.status ?? "尚未开始";
}

function currentLabel(job) {
  if (archiveProgress) {
    const { phase, volume, totalVolumes, index, total, title } = archiveProgress;
    if (phase === "planning") return `正在规划分卷 ${index ?? 0}/${total ?? 0}${title ? ` · ${title}` : ""}`;
    if (phase === "building") return `第 ${volume}/${totalVolumes} 卷 · ${index ?? 0}/${total ?? 0}${title ? ` · ${title}` : ""}`;
    if (phase === "downloading") return `第 ${volume}/${totalVolumes} 卷正在写入下载目录`;
    if (phase === "paused") return `已完成 ${archiveProgress.completed ?? 0}/${totalVolumes ?? 0} 个分卷`;
  }
  const current = job?.current;
  if (!current) return "等待操作";
  const suffix = current.total ? ` · ${current.index ?? 0}/${current.total}` : "";
  if (current.phase === "indexing") return `${current.source === "archived" ? "归档会话" : "普通会话"}：读取第 ${current.offset + 1} 条之后的列表`;
  if (current.phase === "project-indexing") return "正在读取 Projects 列表";
  if (current.phase === "project-conversations") return `正在读取项目：${current.title}`;
  if (current.phase === "exporting") return `${current.title || "正在保存对话"}${suffix}`;
  if (current.phase === "asset-indexing") return `正在建立附件清单${suffix}`;
  if (current.phase === "asset-downloading") return `${current.title || "正在下载附件"}${suffix}`;
  return current.title || "处理中";
}

export const computeProgress = computeBackupProgress;

function renderJob(job) {
  const metricIds = ["regular", "archived", "projects", "project-conversations", "completed", "assets-discovered", "assets-downloaded", "asset-failed", "asset-mb", "failed", "retries", "archive-volumes"];
  if (!job) {
    for (const id of metricIds) elements[id].textContent = id === "asset-mb" ? "0.0" : id === "archive-volumes" ? "0 / 0" : "0";
    elements.phase.textContent = "尚未开始";
    elements["current-title"].textContent = "准备备份";
    elements.percent.textContent = "0%";
    elements.bar.style.width = "0%";
    elements.start.textContent = "开始全量备份";
    elements.download.disabled = true;
    elements["restart-download"].disabled = true;
    elements.diagnostic.disabled = true;
    elements.library.disabled = true;
    elements["metrics-summary"].textContent = "尚无备份数据";
    renderBackupHealth(null);
    return;
  }

  const stats = job.stats ?? {};
  const percent = computeProgress(job, archiveProgress);
  elements.regular.textContent = String(stats.regular ?? 0);
  elements.archived.textContent = String(stats.archived ?? 0);
  elements.projects.textContent = String(stats.projects ?? 0);
  elements["project-conversations"].textContent = String(stats.projectConversations ?? 0);
  elements.completed.textContent = String(stats.completed ?? job.completedIds?.length ?? 0);
  elements["assets-discovered"].textContent = String(stats.assetsDiscovered ?? 0);
  elements["assets-downloaded"].textContent = String(stats.assetsDownloaded ?? 0);
  elements["asset-failed"].textContent = String((stats.assetFailures ?? 0) + (stats.unsupportedAssets ?? 0));
  elements["asset-mb"].textContent = ((stats.assetBytes ?? 0) / 1024 / 1024).toFixed(1);
  elements.failed.textContent = String(stats.failed ?? job.failures?.length ?? 0);
  elements.retries.textContent = String(stats.retries ?? 0);
  elements["metrics-summary"].textContent = `已保存 ${Number(stats.completed ?? job.completedIds?.length ?? 0)} 条 · 失败 ${Number(stats.failed ?? job.failures?.length ?? 0)} · 附件 ${Number(stats.assetsDownloaded ?? 0)}/${Number(stats.assetsDiscovered ?? 0)}`;
  const archiveState = job.archiveExport ?? {};
  elements["archive-volumes"].textContent = `${archiveState.completedVolumes?.length ?? 0} / ${archiveState.totalVolumes ?? 0}`;
  elements.phase.textContent = phaseLabel(job);
  elements["current-title"].textContent = currentLabel(job);
  elements.percent.textContent = `${percent}%`;
  elements.bar.style.width = `${percent}%`;
  if (taskFeedback.active && (activeBackup || activeArchive)) {
    const step = archiveProgress ? 2 : ["asset_indexing", "asset_downloading"].includes(job.status) ? 2 : job.status === "indexing" ? 0 : 1;
    const source = archiveProgress || job.current || {};
    taskFeedback.update({
      title: phaseLabel(job),
      detail: currentLabel(job),
      stage: archiveProgress ? "生成并写入电脑分卷" : job.status === "indexing" ? "扫描会话目录" : job.status?.startsWith("asset") ? "核对附件" : "保存对话到浏览器",
      step,
      progress: percent,
      current: source.index ?? source.completed ?? null,
      total: source.total ?? source.totalVolumes ?? null,
      indeterminate: false,
      anchor: progressAnchor,
    });
  }

  elements.start.textContent = job.status === "completed_with_errors"
    ? "重试待处理项"
    : job.status === "completed"
      ? "检查新增内容"
      : job.status === "paused" || Number(stats.completed ?? 0) > 0
        ? "继续备份"
        : "开始全量备份";
  const canArchive = isCompleted(job) && !activeBackup;
  elements.download.disabled = !canArchive || Boolean(activeArchive);
  elements["restart-download"].disabled = !canArchive || Boolean(activeArchive);
  elements.download.textContent = (archiveState.completedVolumes?.length ?? 0) > 0 && (archiveState.completedVolumes?.length ?? 0) < (archiveState.totalVolumes ?? Infinity)
    ? "继续剩余分卷"
    : "生成低内存备份分卷";
  elements.diagnostic.disabled = false;
  elements.library.disabled = Number(stats.completed ?? job.completedIds?.length ?? 0) <= 0;
  if (job.accountContext?.workspaceLabel) {
    elements.connection.dataset.state = "ok";
    elements.connection.textContent = `已连接 · ${job.accountContext.workspaceLabel}`;
  }
  renderBackupHealth(job);
}

function queueRender(job) {
  pendingRenderJob = job;
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    const value = pendingRenderJob;
    pendingRenderJob = null;
    renderTimer = null;
    renderJob(value);
  }, RENDER_INTERVAL_MS);
}

async function findChatGPTTab() {
  const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*", "https://chat.openai.com/*"] });
  const active = tabs.find((tab) => tab.active) ?? tabs[0] ?? null;
  chatgptTab = active;
  if (active?.id) {
    elements.connection.dataset.state = "ok";
    elements.connection.textContent = "ChatGPT 已连接";
    return active;
  }
  elements.connection.dataset.state = "error";
  elements.connection.textContent = "未找到 ChatGPT 标签页";
  return null;
}

async function populateWorkspaceChoices(tab, existingJob = null) {
  if (!tab?.id) return;
  try {
    const context = await createChatGPTTransport(tab.id).getContext();
    const lockedWorkspace = existingJob?.accountContext?.workspaceId
      ? [{ id: existingJob.accountContext.workspaceId, label: existingJob.accountContext.workspaceLabel || "已备份工作空间" }]
      : [];
    const options = [{ id: "", label: "个人空间" }, ...lockedWorkspace, ...(context.workspaceCandidates ?? [])];
    const seen = new Set();
    elements.workspace.textContent = "";
    for (const item of options) {
      const id = item.id || "";
      if (seen.has(id)) continue;
      seen.add(id);
      const option = document.createElement("option");
      option.value = id;
      option.textContent = item.label || (id ? "工作空间" : "个人空间");
      elements.workspace.append(option);
    }
    const preferred = existingJob?.accountContext?.workspaceId ?? context.workspaceId ?? "";
    if ([...elements.workspace.options].some((option) => option.value === preferred)) elements.workspace.value = preferred;
    const hasExistingData = Boolean((existingJob?.conversations?.length ?? 0) || Number(existingJob?.stats?.completed ?? 0));
    elements.workspace.disabled = hasExistingData;
    elements["workspace-help"].textContent = hasExistingData
      ? "已有备份进度，空间已锁定。清空进度后才可切换，避免混入不同账号。"
      : context.workspaceCandidates?.length > 0
        ? "已读取可用空间。请选择本次要完整备份的空间。"
        : "当前按个人空间运行；授权只存在于本次运行内存中。";
  } catch (error) {
    elements["workspace-help"].textContent = `无法读取空间列表：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function prepareBackupPreflight() {
  if (activeBackup || activeArchive) return;
  clearRecovery();
  elements.start.disabled = true;
  taskFeedback.start({id:"backup-preflight",title:"正在进行备份预检",detail:"检查登录空间、普通/归档会话规模、Project 与浏览器容量。",stage:"连接 ChatGPT",step:0,stepLabels:["连接","统计","容量","确认"],button:elements.start,buttonLabel:"预检中…",anchor:elements["preflight-panel"],current:0,total:5});
  setStatus("正在进行只读预检：登录空间、对话规模和浏览器容量……", "warning");
  try {
    const tab = await findChatGPTTab();
    taskFeedback.update({stage:"已连接登录标签页",step:0,current:1,total:5});
    if (!tab?.id) throw new Error("未找到已登录的 ChatGPT 标签页。");
    const existingJob = await store.getLatestJob(DEFAULT_HISTORY_JOB_ID).catch(() => null);
    const selected = elements.workspace.selectedOptions?.[0];
    const workspaceId = existingJob?.accountContext?.workspaceId ?? elements.workspace.value;
    const workspaceLabel = existingJob?.accountContext?.workspaceLabel ?? selected?.textContent ?? "个人空间";
    const transport = createChatGPTTransport(tab.id, { workspaceId, workspaceLabel });
    const [contextResult, regularResult, archivedResult, projectsResult] = await Promise.allSettled([
      transport.getContext(),
      transport.listConversations({ offset: 0, limit: 1, archived: false }),
      transport.listConversations({ offset: 0, limit: 1, archived: true }),
      transport.listProjects({ cursor: null }),
    ]);
    if (contextResult.status === "rejected") throw contextResult.reason;
    taskFeedback.update({stage:"统计会话与 Project",step:1,current:4,total:5,detail:"普通会话、归档会话和 Project 首批规模已返回。"});
    await readStorageStatus();
    taskFeedback.update({stage:"检查浏览器容量",step:2,current:5,total:5});
    const preflight = buildBackupPreflight({
      workspaceLabel: contextResult.value.workspaceLabel || workspaceLabel,
      existingJob,
      storage: storageStatus,
      assetPolicy: elements["manual-assets"].value || "references-only",
      regularTotal: regularResult.status === "fulfilled" ? regularResult.value.total : null,
      archivedTotal: archivedResult.status === "fulfilled" ? archivedResult.value.total : null,
      projectCount: projectsResult.status === "fulfilled" ? projectsResult.value.items?.length : null,
    });
    elements["preflight-workspace"].textContent = preflight.workspaceLabel;
    elements["preflight-conversations"].textContent = preflight.estimatedConversations === null ? "开始后完整统计" : `约 ${preflight.estimatedConversations} 条`;
    elements["preflight-projects"].textContent = preflight.projectCount === null ? "开始后统计" : `首批发现 ${preflight.projectCount} 个`;
    elements["preflight-assets"].textContent = preflight.assetLabel;
    elements["preflight-storage"].textContent = preflight.storageLabel;
    elements["preflight-note"].textContent = preflight.isResume
      ? "检测到已有检查点。继续后不会重复下载已经确认保存的对话。"
      : "这一步只做只读检查；确认后才开始采集，不会修改 ChatGPT 中的内容。";
    elements["preflight-panel"].hidden = false;
    preflightReady = true;
    setStatus("预检完成。确认空间和附件策略后开始。", "success");
    taskFeedback.success({title:"备份预检完成",detail:"登录空间、会话规模、Project 与浏览器容量已检查；尚未开始采集。",button:elements.start});
  } catch (error) {
    preflightReady = false;
    setStatus(error instanceof Error ? error.message : String(error), "error");
    showRecovery(error);
    taskFeedback.fail({title:"备份预检未完成",detail:error instanceof Error?error.message:String(error),button:elements.start});
  } finally {
    elements.start.disabled = false;
  }
}

function closePreflight() {
  preflightReady = false;
  elements["preflight-panel"].hidden = true;
}

function waitForDownload(downloadId, timeoutMs = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.downloads.onChanged.removeListener(listener);
      reject(new Error("等待浏览器写入分卷超时。已保存的采集数据仍在本机，可重新点击继续分卷。"));
    }, timeoutMs);
    const listener = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === "complete") {
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(listener);
        resolve();
      } else if (delta.state?.current === "interrupted") {
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(listener);
        reject(new Error(`分卷下载被浏览器中断：${delta.error?.current ?? "unknown"}`));
      }
    };
    chrome.downloads.onChanged.addListener(listener);
    chrome.downloads.search({ id: downloadId }, (items) => {
      const item = items?.[0];
      if (item?.state === "complete") {
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(listener);
        resolve();
      }
    });
  });
}

async function downloadBlobAndRelease(blob, filename) {
  const blobUrl = URL.createObjectURL(blob);
  try {
    const downloadId = await chrome.downloads.download({ url: blobUrl, filename, saveAs: false });
    await waitForDownload(downloadId);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

async function downloadArchive(job, { restart = false } = {}) {
  if (activeArchive) return activeArchive;
  activeArchive = (async () => {
    try {
      await acquireManualLease("manual-archive");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
      activeArchive = null;
      return;
    }
    archiveControl.paused = false;
    taskFeedback.start({ title: restart ? "正在重新生成电脑备份" : "正在生成电脑备份", detail: "正在规划低内存分卷；已完成分卷会逐卷写入下载目录。", stage: "规划分卷", step: 0, button: restart ? elements["restart-download"] : elements.download, buttonLabel: "正在生成…", anchor: progressAnchor, progress: 1, indeterminate: false });
    elements.start.disabled = true;
    elements.pause.disabled = false;
    elements.reset.disabled = true;
    elements.download.disabled = true;
    elements["restart-download"].disabled = true;
    lastProgressAt = Date.now();
    addLog(restart ? "重新规划全部低内存分卷" : "开始或继续低内存分卷");
    setStatus("正在读取本地索引并规划分卷；不会一次性载入全部附件。", "warning");
    archiveProgress = { phase: "planning", index: 0, total: Number(job.stats?.completed ?? 0), completed: 0, totalVolumes: 0 };
    renderJob(job);

    try {
      const plan = await createLowMemoryHistoryArchivePlan({
        store,
        job,
        generatedAt: new Date(job.completedAt ?? Date.now()),
        maxVolumeBytes: ARCHIVE_VOLUME_BYTES,
        onProgress: (event) => {
          lastProgressAt = Date.now();
          archiveProgress = { phase: "planning", index: event.index, total: event.total, title: event.title, completed: 0, totalVolumes: 0 };
          queueRender(job);
        },
      });
      const oldState = job.archiveExport ?? {};
      const planChanged = oldState.planId !== plan.id || oldState.totalVolumes !== plan.volumeCount;
      const completedVolumes = new Set(!restart && !planChanged ? oldState.completedVolumes ?? [] : []);
      job.archiveExport = {
        status: "building",
        planId: plan.id,
        totalVolumes: plan.volumeCount,
        completedVolumes: [...completedVolumes],
        updatedAt: new Date().toISOString(),
      };
      await store.saveJob(job);
      addLog(`分卷规划完成：共 ${plan.volumeCount} 卷，目标约 ${Math.round(ARCHIVE_VOLUME_BYTES / 1024 / 1024)} MB/卷`);

      for (let number = 1; number <= plan.volumeCount; number += 1) {
        if (completedVolumes.has(number)) continue;
        if (archiveControl.paused) {
          job.archiveExport.status = "paused";
          job.archiveExport.updatedAt = new Date().toISOString();
          await store.saveJob(job);
          archiveProgress = { phase: "paused", completed: completedVolumes.size, totalVolumes: plan.volumeCount };
          setStatus(`分卷已暂停。已完成 ${completedVolumes.size}/${plan.volumeCount}，再次点击可继续。`, "warning");
          taskFeedback.pause({ title: "电脑备份已暂停", detail: elements.status.textContent, stage: "检查点已保存" });
          renderJob(job);
          return;
        }
        archiveProgress = { phase: "building", volume: number, totalVolumes: plan.volumeCount, index: 0, total: plan.volumes[number - 1].descriptors.length, completed: completedVolumes.size };
        setStatus(`正在生成第 ${number}/${plan.volumeCount} 个分卷。当前只保留这一卷的数据。`);
        renderJob(job);
        const volume = await buildLowMemoryHistoryArchiveVolume({
          plan,
          volumeNumber: number,
          store,
          job,
          onProgress: (event) => {
            lastProgressAt = Date.now();
            archiveProgress = { phase: "building", volume: event.volume, totalVolumes: event.totalVolumes, index: event.index, total: event.total, title: event.title, completed: completedVolumes.size };
            queueRender(job);
          },
        });
        archiveProgress = { phase: "downloading", volume: number, totalVolumes: plan.volumeCount, completed: completedVolumes.size };
        setStatus(`第 ${number}/${plan.volumeCount} 卷已生成，正在等待浏览器完成写盘……`);
        renderJob(job);
        await downloadBlobAndRelease(volume.blob, volume.filename);
        completedVolumes.add(number);
        job.archiveExport.completedVolumes = [...completedVolumes].sort((a, b) => a - b);
        job.archiveExport.updatedAt = new Date().toISOString();
        await store.saveJob(job);
        addLog(`第 ${number}/${plan.volumeCount} 卷已写盘并释放内存：${volume.filename}`);
        archiveProgress = { phase: "building", volume: number + 1, totalVolumes: plan.volumeCount, completed: completedVolumes.size, index: 0, total: 0 };
        renderJob(job);
        await nextTask();
      }

      job.archiveExport.status = "completed";
      job.archiveExport.updatedAt = new Date().toISOString();
      await store.saveJob(job);
      archiveProgress = null;
      const tone = plan.assetReport.status === "COMPLETE" && !job.failures.length ? "success" : "warning";
      setStatus(plan.volumeCount === 1
        ? "备份包已完成下载，内存已释放。"
        : `全部 ${plan.volumeCount} 个分卷已完成。请全部解压到同一目录。`, tone);
      addLog(`低内存全量备份完成：${plan.volumeCount} 个分卷`);
      taskFeedback.success({ title: "电脑备份分卷已完成", detail: elements.status.textContent, stage: "全部分卷已写盘" });
      renderJob(job);
    } catch (error) {
      job.archiveExport ??= {};
      job.archiveExport.status = "paused";
      job.archiveExport.updatedAt = new Date().toISOString();
      await store.saveJob(job).catch(() => {});
      archiveProgress = { phase: "paused", completed: job.archiveExport.completedVolumes?.length ?? 0, totalVolumes: job.archiveExport.totalVolumes ?? 0 };
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message, "error");
      taskFeedback.fail({ title: "电脑备份生成中断", detail: message });
      showRecovery(error);
      addLog(`分卷中断：${error instanceof Error ? error.message : String(error)}`);
      renderJob(job);
    } finally {
      await releaseManualLease();
      activeArchive = null;
      elements.start.disabled = false;
      elements.pause.disabled = true;
      elements.reset.disabled = false;
      renderJob(await store.getLatestJob(DEFAULT_HISTORY_JOB_ID));
    }
  })();
  return activeArchive;
}

async function downloadAcceptanceDiagnostic(job) {
  taskFeedback.start({id:"acceptance-diagnostic",title:"正在生成验收诊断报告",detail:"读取附件元数据、计算验收门槛并生成脱敏 HTML。",stage:"读取附件清单",step:0,stepLabels:["读取","计算","生成","下载"],indeterminate:true});
  const assets = await store.listAssetMetadata(job.id);
  taskFeedback.update({stage:"计算验收门槛",step:1,detail:`已读取 ${assets.length} 条附件元数据。`});
  const report = buildAcceptanceDiagnostic({ job, assets, extensionVersion: chrome.runtime.getManifest().version, generatedAt: new Date() });
  const html = renderAcceptanceDiagnosticHtml(report);
  taskFeedback.update({stage:"生成脱敏报告",step:2,indeterminate:true});
  const filename = `KV-Archive-Acceptance-Diagnostic-${new Date().toISOString().slice(0, 10)}.html`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
    taskFeedback.success({title:"验收诊断报告已提交下载",detail:filename});
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  setStatus(report.gate.passed ? "脱敏验收报告已生成：当前门槛通过。" : "脱敏验收报告已生成：仍有待修复项。", report.gate.passed ? "success" : "warning");
  addLog(`已导出脱敏验收报告：${filename}`);
}

async function addCurrentBackupToLibrary(job) {
  setStatus("正在把已保存对话加入本地资料库……");
  const artifactIds = await store.listArtifactIds(job.id);
  if (!artifactIds.length) throw new Error("当前没有可索引的对话缓存");
  const candidates = [];
  for (let index = 0; index < artifactIds.length; index += 1) {
    const artifact = await store.getArtifact(job.id, artifactIds[index]);
    if (!artifact) continue;
    candidates.push({
      canonical: normalizeChatGPTConversation(artifact.raw, { adapter: "context-vault-local-cache", sourceUrl: `https://chatgpt.com/c/${artifact.conversationId}` }),
      rawEvidence: artifact.raw,
      sourceMetadata: artifact.metadata ?? null,
      source: { kind: "context-vault", fileName: "KV Archive 本机备份缓存", fingerprint: `${job.id}:${job.updatedAt || job.completedAt || "local"}` },
    });
    if ((index + 1) % 10 === 0) {
      setStatus(`正在准备资料库索引 ${index + 1}/${artifactIds.length}……`);
      await nextTask();
    }
  }
  const report = await importCandidatesIntoVault({
    candidates,
    store: libraryStore,
    onProgress: (event) => {
      if (event.phase === "indexing") setStatus(`正在索引 ${event.index}/${event.total}：${event.title}`);
    },
    importMetadata: {
      files: 0,
      detected: { contextVault: candidates.length, official: 0 },
      fileNames: ["KV Archive 本机备份缓存"],
      fingerprints: [`${job.id}:${job.updatedAt || job.completedAt || "local"}`],
    },
  });
  setStatus(`资料库已更新：新增 ${report.inserted}，更新 ${report.updated}，重复 ${report.duplicate}，旧版本保留 ${report.stale}，失败 ${report.failed}。`, report.failed ? "warning" : "success");
  addLog(`已加入本地资料库：新增 ${report.inserted}，更新 ${report.updated}，重复 ${report.duplicate}，旧版本保留 ${report.stale}`);
}

function progressEvent(event) {
  lastProgressAt = Date.now();
  queueRender(event.job);
  switch (event.type) {
    case "indexed-page":
      addLog(`${event.source === "archived" ? "归档" : "普通历史"}索引页完成，新增 ${event.added} 条${event.refreshed ? `，更新 ${event.refreshed} 条` : ""}`);
      break;
    case "project-page":
      addLog(`Projects 列表页完成，新增 ${event.added} 个项目`);
      break;
    case "project-conversation-page":
      addLog(`项目“${event.project.title}”新增 ${event.added} 条会话`);
      break;
    case "conversation-start":
      setStatus(`正在保存对话 ${event.index ?? 0}/${event.total ?? 0}：${event.metadata.title}`);
      break;
    case "conversation-complete":
      successCounters.conversations += 1;
      if (successCounters.conversations % 25 === 0 || event.index === event.total) addLog(`对话保存进度：${event.index}/${event.total}`);
      break;
    case "conversation-failed":
      addLog(`对话失败：${event.metadata.title}｜${event.error?.message ?? event.error}`);
      break;
    case "asset-indexing":
      setStatus("正在逐条扫描对话和 Projects 中的附件引用……");
      break;
    case "asset-indexing-progress":
      setStatus(`正在扫描附件引用 ${event.index}/${event.total}，已发现 ${event.discovered} 项`);
      break;
    case "asset-inventory-complete":
      addLog(`附件清单完成：发现 ${event.discovered} 项，暂不支持 ${event.unsupported} 项`);
      break;
    case "asset-start":
      setStatus(`对话已安全保存。正在按你的选择下载附件 ${event.index ?? 0}/${event.total ?? 0}：${event.asset.fileName}`);
      break;
    case "asset-complete":
      successCounters.assets += 1;
      if (successCounters.assets % 10 === 0 || event.index === event.total) addLog(`附件保存进度：${event.index}/${event.total}`);
      break;
    case "asset-failed":
      addLog(`附件失败：${event.asset.fileName}｜${event.error?.message ?? event.error}`);
      break;
    case "retry":
      addLog(`请求受限，${Math.ceil(event.delay / 1000)} 秒后重试`);
      break;
    case "job-complete":
      addLog(event.assetPolicy === "references-only"
        ? "对话已安全保存；附件仅记录来源引用"
        : "对话与可访问附件已安全保存到本地数据库");
      break;
  }
}

async function runBackup() {
  if (activeBackup || activeArchive) return activeBackup;
  clearRecovery();
  closePreflight();
  activeBackup = (async () => {
    let leaseAcquired = false;
    try {
      await acquireManualLease("manual-backup");
      leaseAcquired = true;
      backupControl.paused = false;
      successCounters = { conversations: 0, assets: 0 };
      const tab = await findChatGPTTab();
      if (!tab?.id) {
        setStatus("请先打开并登录 ChatGPT，再返回本页。", "error");
        await chrome.tabs.create({ url: "https://chatgpt.com/" });
        return;
      }
      elements.start.disabled = true;
      elements.pause.disabled = false;
      elements.reset.disabled = true;
      elements.download.disabled = true;
      elements["restart-download"].disabled = true;
      elements.diagnostic.disabled = true;
      elements["manual-assets"].disabled = true;
      setStatus("正在识别当前工作空间并建立索引……");
      taskFeedback.start({ title: "正在采集平台历史", detail: "先扫描会话目录，再逐条保存到浏览器本地。页面可随时查看进度。", stage: "识别账号空间", step: 0, button: elements["preflight-confirm"], buttonLabel: "采集中…", anchor: progressAnchor, progress: 1, indeterminate: false });
      const assetPolicy = elements["manual-assets"].value || "references-only";
      addLog(assetPolicy === "download"
        ? "开始或继续 ChatGPT 对话与附件采集"
        : "开始或继续 ChatGPT 对话采集；附件仅记录引用");
      lastProgressAt = Date.now();
      const existingJob = await store.getLatestJob(DEFAULT_HISTORY_JOB_ID).catch(() => null);
      const selected = elements.workspace.selectedOptions?.[0];
      const workspaceId = existingJob?.accountContext?.workspaceId ?? elements.workspace.value;
      const workspaceLabel = existingJob?.accountContext?.workspaceLabel ?? selected?.textContent ?? "个人空间";
      const transport = createChatGPTTransport(tab.id, { workspaceId, workspaceLabel });
      const job = await runUnifiedHistoryBackup({
        store,
        transport,
        onProgress: progressEvent,
        control: backupControl,
        requestDelayMs: 300,
        assetPolicy,
        maxAssetBytes: SAFE_MAX_ASSET_BYTES,
        refreshCompletedWithErrors: true,
      });
      renderJob(job);
      for (const warning of job.warnings ?? []) addLog(`提示：${warning}`);
      if (job.status === "paused") {
        setStatus("采集已暂停，进度和已保存数据仍在本机。", "warning");
        taskFeedback.pause({ title: "历史采集已暂停", detail: elements.status.textContent, stage: "检查点已保存" });
        return;
      }
      const scheduleSettings = await snapshotStore.getSettings();
      const snapshotResult = await createLogicalSnapshot({
        historyStore: store, snapshotStore, job, source: "manual", retention: scheduleSettings.retention,
      });
      setStatus(assetPolicy === "download"
        ? "对话已保存；可访问附件也已按需下载。请点击“生成低内存备份分卷”。"
        : "对话已安全保存；附件仅保留来源引用，未占用额外二进制存储。请点击“生成低内存备份分卷”。",
      job.status === "completed" ? "success" : "warning");
      addLog(snapshotResult.created
        ? `本地采集完成并创建逻辑快照：${snapshotResult.snapshot.id}`
        : "本地采集完成；内容未变化，未重复创建逻辑快照");
      taskFeedback.success({ title: "平台历史已保存到浏览器", detail: elements.status.textContent, stage: "逻辑快照已核验" });
      await loadScheduleStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message, "error");
      taskFeedback.fail({ title: "历史采集未完成", detail: message });
      showRecovery(error);
      addLog(`中断：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (leaseAcquired) await releaseManualLease();
      elements.start.disabled = false;
      elements.pause.disabled = true;
      elements.reset.disabled = false;
      elements["manual-assets"].disabled = false;
      const latest = await store.getLatestJob(DEFAULT_HISTORY_JOB_ID).catch(() => null);
      elements.diagnostic.disabled = !latest;
      activeBackup = null;
      await readStorageStatus();
      renderJob(latest);
    }
  })();
  return activeBackup;
}

elements.start.addEventListener("click", prepareBackupPreflight);
elements.pause.addEventListener("click", () => {
  if (activeArchive) {
    archiveControl.paused = true;
    elements.pause.disabled = true;
    setStatus("当前分卷完成写盘后暂停；已完成分卷不会丢失。", "warning");
    taskFeedback.update({ stage: "正在安全暂停", detail: elements.status.textContent, step: 2 });
  } else {
    backupControl.paused = true;
    elements.pause.disabled = true;
    setStatus("正在完成当前请求，随后暂停……", "warning");
    taskFeedback.update({ stage: "正在安全暂停", detail: elements.status.textContent, step: 1 });
  }
});
elements.download.addEventListener("click", async () => {
  const job = await store.getLatestJob(DEFAULT_HISTORY_JOB_ID);
  if (!job) return setStatus("没有可下载的全量备份", "error");
  await downloadArchive(job, { restart: false });
});
elements["restart-download"].addEventListener("click", async () => {
  const job = await store.getLatestJob(DEFAULT_HISTORY_JOB_ID);
  if (!job) return setStatus("没有可下载的全量备份", "error");
  if (!confirm("确认从第 1 卷重新生成全部分卷？本地采集数据不会重新下载。")) return;
  await downloadArchive(job, { restart: true });
});
elements.diagnostic.addEventListener("click", async () => {
  try {
    const job = await store.getLatestJob(DEFAULT_HISTORY_JOB_ID);
    if (!job) throw new Error("尚无可诊断的备份任务");
    await downloadAcceptanceDiagnostic(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, "error");
    taskFeedback.fail({title:"验收诊断报告生成失败",detail:message});
  }
});
elements.library.addEventListener("click", async () => {
  try {
    const job = await store.getLatestJob(DEFAULT_HISTORY_JOB_ID);
    if (!job) throw new Error("尚无可加入资料库的备份任务");
    elements.library.disabled = true;
    taskFeedback.start({ title: "正在加入本地资料库", detail: "正在建立可搜索索引，原始备份证据不会被改写。", stage: "解析并建立索引", step: 1, button: elements.library, buttonLabel: "正在加入…", indeterminate: true });
    await addCurrentBackupToLibrary(job);
    taskFeedback.success({ title: "已加入本地资料库", detail: "正在打开资料库查看结果。", stage: "索引已完成", button: elements.library });
    window.location.assign(chrome.runtime.getURL("library.html"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, "error");
    taskFeedback.fail({ title: "加入资料库失败", detail: message, button: elements.library });
  } finally {
    elements.library.disabled = false;
  }
});
elements.reset.addEventListener("click", async () => {
  if (activeBackup || activeArchive) return;
  if (!confirm("确认清空本机保存的全量备份进度、对话和附件缓存？此操作不会删除原 AI 平台中的内容。")) return;
  taskFeedback.start({id:"backup-reset",title:"正在清空本轮备份进度",detail:"停止相关任务并删除本轮会话缓存、附件缓存、检查点和分卷记录。",stage:"删除本地检查点",step:1,stepLabels:["停止","删除","重建","完成"],button:elements.reset,buttonLabel:"正在清空…",indeterminate:true});
  try {
    await store.clearJob(DEFAULT_HISTORY_JOB_ID);
    taskFeedback.update({stage:"重建空白工作区",step:2,detail:"缓存和检查点已删除，正在刷新页面状态。"});
    elements.workspace.disabled = false;
    await populateWorkspaceChoices(chatgptTab, null);
    archiveProgress = null;
    renderJob(null);
    setStatus("已清空本轮备份进度。", "success");
    addLog("已清空本地进度");
    taskFeedback.success({title:"本轮备份进度已清空",detail:"只清除了浏览器中的本轮任务缓存，已下载文件不受影响。",button:elements.reset});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, "error");
    taskFeedback.fail({title:"清空未完成",detail:message,button:elements.reset});
  }
});
elements["clear-log"].addEventListener("click", () => { elements.log.textContent = ""; });
elements["schedule-save"].addEventListener("click", saveScheduleSettings);
elements["schedule-run"].addEventListener("click", runScheduleNow);
elements["schedule-refresh"].addEventListener("click", loadScheduleStatus);
elements["schedule-test-start"].addEventListener("click", startTenMinuteScheduleTest);
elements["schedule-test-cancel"].addEventListener("click", cancelTenMinuteScheduleTest);
elements["preflight-close"].addEventListener("click", closePreflight);
elements["preflight-cancel"].addEventListener("click", closePreflight);
elements["preflight-confirm"].addEventListener("click", async () => {
  if (!preflightReady) return prepareBackupPreflight();
  elements["preflight-confirm"].disabled = true;
  await readStorageStatus({ requestPersist: true });
  const job = await store.getLatestJob(DEFAULT_HISTORY_JOB_ID).catch(() => null);
  renderBackupHealth(job);
  try { await runBackup(); }
  finally { elements["preflight-confirm"].disabled = false; }
});
elements["health-action"].addEventListener("click", async () => {
  const job = await store.getLatestJob(DEFAULT_HISTORY_JOB_ID).catch(() => null);
  if (job && isCompleted(job) && job.archiveExport?.status !== "completed") {
    document.querySelector(".progress-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    elements.download.focus();
    return;
  }
  document.querySelector(".progress-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  await prepareBackupPreflight();
});
elements["recovery-primary"].addEventListener("click", async () => {
  if (!lastRecovery) return;
  if (["open-chatgpt", "refresh-session"].includes(lastRecovery.kind)) {
    await chrome.tabs.create({ url: "https://chatgpt.com/" });
  } else if (lastRecovery.kind === "choose-workspace") {
    elements.workspace.disabled = false;
    elements.workspace.focus();
    setStatus("请选择正确的 ChatGPT 空间，再重新预检。", "warning");
  } else if (lastRecovery.kind === "show-downloads") {
    chrome.downloads.showDefaultFolder();
  } else {
    await prepareBackupPreflight();
  }
});
elements["recovery-secondary"].addEventListener("click", async () => {
  if (lastRecovery?.kind === "show-downloads") {
    const job = await store.getLatestJob(DEFAULT_HISTORY_JOB_ID).catch(() => null);
    if (job) await downloadArchive(job, { restart: false });
  } else {
    await findChatGPTTab();
    await prepareBackupPreflight();
  }
});

setInterval(() => {
  if (!activeBackup && !activeArchive) return;
  const quietSeconds = Math.floor((Date.now() - lastProgressAt) / 1000);
  if (quietSeconds >= 12) {
    const operation = activeArchive ? "分卷生成" : "全量采集";
    setStatus(`${operation}仍在运行，当前步骤已持续 ${quietSeconds} 秒。数据会按检查点保存，请不要重复点击。`, "warning");
  }
}, 2_000);

await findChatGPTTab();
await readStorageStatus();
await loadScheduleStatus();
const existing = await store.getLatestJob(DEFAULT_HISTORY_JOB_ID);
await populateWorkspaceChoices(chatgptTab, existing);
renderJob(existing);
if (existing?.status === "paused" || (existing && !isCompleted(existing))) {
  setStatus("检测到未完成采集，可以从上次检查点继续。", "warning");
} else if (isCompleted(existing)) {
  const remaining = Math.max(0, Number(existing.archiveExport?.totalVolumes ?? 0) - Number(existing.archiveExport?.completedVolumes?.length ?? 0));
  if (remaining > 0) setStatus(`本地采集已完成，仍有 ${remaining} 个分卷未生成，可继续。`, "warning");
  else if (existing.archiveExport?.status === "completed") setStatus("本地采集和全部分卷均已完成。", "success");
  else setStatus("本地采集已完成。点击“生成低内存备份分卷”开始打包。", (existing.failures?.length || existing.assets?.failures?.length || existing.assets?.unsupportedKeys?.length) ? "warning" : "success");
}
