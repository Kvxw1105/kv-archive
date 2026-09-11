import { createChatGPTTransport } from "./history-api.js";
import { loadChatGPTConversationCatalog } from "./conversation-catalog.js";
import {
  createConversationSelectionSet,
  filterConversationRefs,
  selectionJobId,
  toggleConversationSelection,
} from "./conversation-selection.js";
import { createConversationSelectionStore } from "./conversation-selection-store.js";
import { createConversationCatalogStore } from "./conversation-catalog-store.js";
import { createIndexedDbHistoryStore } from "./history-store.js";
import { reconcileDurableProgress, runSelectedConversationExport } from "./history-engine.js";
import { createLowMemoryHistoryArchivePlan, buildLowMemoryHistoryArchiveVolume } from "./history-archive.js";
import { createSavedHistoryExportSnapshot } from "./history-export-snapshot.js";
import { createTaskFeedback } from "./task-feedback.js";
import { buildBasketCatalog, captureEligibility } from "./conversation-catalog-view.js";

const byId = (id) => document.getElementById(id);
const elements = Object.fromEntries([
  "connection", "load", "select-visible", "clear-selection", "provider", "query", "collection", "scope",
  "catalog-summary", "visible-count", "conversation-list", "catalog-render-meta", "load-more-conversations",
  "selected-count", "selection-title", "selected-list", "asset-policy", "export-selected", "pause-capture",
  "export-saved", "save-selection", "new-batch", "phase", "progress-title", "percent", "bar", "status",
  "task-summary", "task-selected-count", "saved-count", "remaining-count", "failed-count", "capture-step",
  "export-step", "log",
].map((id) => [id, byId(id)]));

const selectionStore = createConversationSelectionStore();
const catalogStore = createConversationCatalogStore();
const historyStore = createIndexedDbHistoryStore();
const UI_PREFS_KEY = "kv-archive:basket-ui:v1";
const CATALOG_RENDER_BATCH = 180;
const SELECTION_PREVIEW_LIMIT = 80;
const ARCHIVE_VOLUME_BYTES = 380 * 1024 * 1024;

let catalog = null;
let catalogCachedAt = null;
let selection = createConversationSelectionSet({ title: elements["selection-title"].value, refs: [] });
let visibleRefs = [];
let visibleRenderLimit = CATALOG_RENDER_BATCH;
let chatgptTab = null;
let catalogBusy = false;
let selectionSaveTimer = null;
let currentJob = null;
let activeCapture = null;
let activeArchive = null;
let pendingExportAfterPause = false;
let lastExportedCount = 0;
const captureControl = { paused: false, reason: "user" };
const archiveControl = { paused: false };
const taskFeedback = createTaskFeedback({ page: "CONVERSATION BASKET", autoScroll: true });
const taskAnchor = document.querySelector(".progress-card");

function log(message) {
  const row = document.createElement("li");
  row.textContent = `${new Date().toLocaleTimeString()} · ${message}`;
  elements.log.prepend(row);
  while (elements.log.children.length > 80) elements.log.lastElementChild?.remove();
}

function setStatus(message, tone = "") {
  elements.status.textContent = message;
  elements.status.dataset.tone = tone;
}

function setProgress({ phase = "WORKING", title = "处理中", current = 0, total = 1 } = {}) {
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round(current / total * 100))) : 0;
  elements.phase.textContent = phase;
  elements["progress-title"].textContent = title;
  elements.percent.textContent = `${percent}%`;
  elements.bar.style.width = `${percent}%`;
  if (taskFeedback.active) {
    taskFeedback.update({
      title,
      stage: phase,
      current,
      total,
      progress: percent,
      step: ["INDEXING", "CAPTURING", "ASSETS", "PACKING"].includes(phase) ? 1 : phase === "DONE" || phase === "READY" ? 3 : 0,
      anchor: taskAnchor,
    });
  }
}

function setStepState(element, state) {
  element.dataset.state = state;
}

function taskCounts(job = currentJob) {
  const selected = Number(job?.selection?.total ?? selection.items.length ?? 0);
  const saved = Number(job?.completedIds?.length ?? 0);
  const failed = Number(job?.failures?.length ?? 0);
  return { selected, saved, failed, remaining: Math.max(0, selected - saved) };
}

function hasTaskProgress(job = currentJob) {
  if (!job) return false;
  return Number(job.completedIds?.length ?? 0) > 0 || !["idle", undefined, null].includes(job.status);
}

function selectionMatchesJob(job = currentJob) {
  return !job?.selection?.fingerprint || job.selection.fingerprint === selection.fingerprint;
}

function selectionLocked() {
  return hasTaskProgress(currentJob) && selectionMatchesJob(currentJob);
}

function restoreUiPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(UI_PREFS_KEY) || "null");
    if (!value) return;
    if (typeof value.query === "string") elements.query.value = value.query;
    if (typeof value.provider === "string") elements.provider.value = value.provider;
    if (typeof value.collection === "string") elements.collection.value = value.collection;
    if (["all", "active", "archived"].includes(value.scope)) elements.scope.value = value.scope;
    if (["references-only", "download"].includes(value.assetPolicy)) elements["asset-policy"].value = value.assetPolicy;
  } catch { /* keep safe defaults */ }
}

function persistUiPreferences() {
  try {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify({
      query: elements.query.value,
      provider: elements.provider.value,
      scope: elements.scope.value,
      collection: elements.collection.value,
      assetPolicy: elements["asset-policy"].value,
    }));
  } catch { /* preferences are optional */ }
}

async function findChatGPTTab() {
  const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*", "https://chat.openai.com/*"] });
  chatgptTab = tabs.find((tab) => tab.active) ?? tabs.sort((a, b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0))[0] ?? null;
  elements.connection.textContent = chatgptTab ? "ChatGPT 已连接" : "未找到 ChatGPT 标签页";
  elements.connection.dataset.state = chatgptTab ? "ok" : "error";
  return chatgptTab;
}

function formatTime(value) {
  if (value === null || value === undefined || value === "") return "时间未知";
  const number = Number(value);
  const date = Number.isFinite(number) ? new Date(number < 1e12 ? number * 1000 : number) : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function selectionForSave() {
  return createConversationSelectionSet({
    id: selection.id,
    title: elements["selection-title"].value,
    provider: null,
    accountScopeId: null,
    refs: selection.items,
    createdAt: selection.createdAt,
  });
}

async function saveSelectionNow({ announce = false } = {}) {
  selection = selectionForSave();
  await selectionStore.put(selection);
  elements["save-selection"].textContent = "已自动保存";
  if (announce) setStatus(`选择集“${selection.title}”已保存在本地。`, "success");
  setTimeout(() => { elements["save-selection"].textContent = "立即保存"; }, 1200);
}

function scheduleSelectionSave() {
  if (selectionLocked()) return;
  clearTimeout(selectionSaveTimer);
  elements["save-selection"].textContent = "正在保存…";
  selectionSaveTimer = setTimeout(() => {
    saveSelectionNow().catch((error) => {
      elements["save-selection"].textContent = "保存失败";
      setStatus(`自动保存失败：${error instanceof Error ? error.message : String(error)}`, "error");
    });
  }, 180);
}

async function loadCurrentJob() {
  if (!selection?.id) {
    currentJob = null;
    return null;
  }
  currentJob = await historyStore.getLatestJob(selectionJobId(selection)).catch(() => null);
  if (currentJob) {
    currentJob = await reconcileDurableProgress(currentJob, historyStore);
    await historyStore.saveJob(currentJob).catch(() => {});
  }
  return currentJob;
}

function renderTask(job = currentJob) {
  const counts = taskCounts(job);
  const mismatch = Boolean(job && !selectionMatchesJob(job));
  const locked = selectionLocked();
  const captureComplete = counts.selected > 0 && counts.saved >= counts.selected && ["completed", "completed_with_errors"].includes(job?.status);
  const captureActive = Boolean(activeCapture);
  const archiveActive = Boolean(activeArchive);

  elements["task-selected-count"].textContent = String(counts.selected);
  elements["saved-count"].textContent = String(counts.saved);
  elements["remaining-count"].textContent = String(counts.remaining);
  elements["failed-count"].textContent = String(counts.failed);

  setStepState(elements["capture-step"], captureActive ? "active" : captureComplete ? "complete" : "idle");
  setStepState(elements["export-step"], archiveActive ? "active" : lastExportedCount > 0 && lastExportedCount === counts.saved ? "complete" : "idle");

  elements["export-selected"].disabled = catalogBusy || captureActive || archiveActive || selection.items.length === 0 || mismatch || captureComplete;
  elements["export-selected"].textContent = counts.saved > 0 ? "继续采集到浏览器" : "开始采集到浏览器";
  if (captureComplete) elements["export-selected"].textContent = "采集已完成";

  elements["pause-capture"].disabled = !captureActive && !archiveActive;
  elements["pause-capture"].textContent = archiveActive ? "暂停导出" : captureControl.paused ? "正在暂停…" : "暂停采集";
  elements["export-saved"].disabled = counts.saved <= 0 || archiveActive;
  elements["export-saved"].textContent = captureActive ? "暂停并导出已保存" : `导出已保存到本地${counts.saved ? `（${counts.saved}）` : ""}`;
  elements["new-batch"].hidden = !locked && !mismatch;
  elements["new-batch"].disabled = captureActive || archiveActive;

  elements["save-selection"].disabled = catalogBusy || captureActive || archiveActive || locked;
  elements["selection-title"].disabled = locked || captureActive || archiveActive;
  elements["asset-policy"].disabled = captureActive || archiveActive;
  elements["select-visible"].disabled = !catalog || locked || captureActive || archiveActive;
  elements["clear-selection"].disabled = selection.items.length === 0 || locked || captureActive || archiveActive;

  if (mismatch) {
    elements["task-summary"].textContent = "当前选择已经和旧采集批次不同。为防止进度串线，请新建一个选择批次。";
  } else if (captureActive) {
    elements["task-summary"].textContent = `正在采集；已保存 ${counts.saved}/${counts.selected} 条。暂停会先完成当前请求，再保留检查点。`;
  } else if (archiveActive) {
    elements["task-summary"].textContent = `正在把已保存的 ${counts.saved} 条会话打包到本地，不会重新请求 ChatGPT。`;
  } else if (job?.status === "paused") {
    elements["task-summary"].textContent = `采集已暂停：已保存 ${counts.saved} 条，剩余 ${counts.remaining} 条。可先导出，也可稍后继续。`;
  } else if (captureComplete) {
    elements["task-summary"].textContent = `采集完成：${counts.saved} 条已安全保存在浏览器。现在可以独立导出到本地。`;
  } else if (counts.saved > 0) {
    elements["task-summary"].textContent = `上次采集留下 ${counts.saved} 条安全成果，剩余 ${counts.remaining} 条。可继续，也可先导出。`;
  } else {
    elements["task-summary"].textContent = "没有进行中的采集批次。采集与本地导出是两个独立步骤。";
  }

  if (!captureActive && !archiveActive) {
    if (job?.status === "paused") setProgress({ phase: "PAUSED", title: "已暂停，可继续或先导出", current: counts.saved, total: counts.selected || 1 });
    else if (captureComplete) setProgress({ phase: "READY", title: "采集完成，等待导出", current: counts.saved, total: counts.selected || 1 });
    else if (counts.saved > 0) setProgress({ phase: "RESUMABLE", title: "发现可继续的采集进度", current: counts.saved, total: counts.selected || 1 });
  }
}

function populateCatalogView(nextCatalog, { cachedAt = null } = {}) {
  catalog = nextCatalog;
  catalogCachedAt = cachedAt;
  const preferredCollection = (() => {
    try { return JSON.parse(localStorage.getItem(UI_PREFS_KEY) || "null")?.collection || ""; }
    catch { return ""; }
  })();
  const preferredProvider = (() => {
    try { return JSON.parse(localStorage.getItem(UI_PREFS_KEY) || "null")?.provider || ""; }
    catch { return ""; }
  })();
  elements.provider.innerHTML = '<option value="">全部平台</option>';
  for (const item of nextCatalog.providers || []) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.label} (${item.count})`;
    elements.provider.append(option);
  }
  if ([...elements.provider.options].some((option) => option.value === preferredProvider)) elements.provider.value = preferredProvider;
  elements.collection.innerHTML = '<option value="">全部项目与空间</option>';
  for (const item of nextCatalog.collections || []) {
    const option = document.createElement("option");
    option.value = item.key;
    option.textContent = `${item.providerLabel} · ${item.title || "未命名项目"}`;
    elements.collection.append(option);
  }
  if ([...elements.collection.options].some((option) => option.value === preferredCollection)) elements.collection.value = preferredCollection;
  const cacheText = cachedAt ? ` · 本地缓存 ${formatTime(cachedAt)}` : "";
  elements["catalog-summary"].textContent = `${catalog.accountScopeLabel || "当前空间"} · 共 ${catalog.conversations.length} 条可选择会话${cacheText}`;
  elements.load.textContent = "刷新会话目录";
  applyFilters();
}

function applyFilters() {
  persistUiPreferences();
  visibleRenderLimit = CATALOG_RENDER_BATCH;
  if (!catalog) {
    visibleRefs = [];
    renderAvailable();
    return;
  }
  let refs = filterConversationRefs(catalog.conversations, elements.query.value, { provider: elements.provider.value, collectionKey: elements.collection.value });
  if (elements.scope.value === "active") refs = refs.filter((ref) => !ref.isArchived);
  else if (elements.scope.value === "archived") refs = refs.filter((ref) => ref.isArchived);
  visibleRefs = refs;
  renderAvailable();
}

function renderAvailable() {
  elements["visible-count"].textContent = String(visibleRefs.length);
  elements["conversation-list"].textContent = "";
  const locked = selectionLocked();
  if (!catalog) {
    elements["conversation-list"].innerHTML = '<div class="empty">尚未读取会话目录。</div>';
    elements["catalog-render-meta"].textContent = "尚无目录";
    elements["load-more-conversations"].hidden = true;
    return;
  }
  if (!visibleRefs.length) {
    elements["conversation-list"].innerHTML = '<div class="empty">没有符合条件的会话。</div>';
    elements["catalog-render-meta"].textContent = "0 条结果";
    elements["load-more-conversations"].hidden = true;
    return;
  }
  const selectedKeys = new Set(selection.items.map((item) => item.key));
  const renderedRefs = visibleRefs.slice(0, visibleRenderLimit);
  const fragment = document.createDocumentFragment();
  for (const ref of renderedRefs) {
    const label = document.createElement("label");
    label.className = "conversation-row";
    label.dataset.selected = String(selectedKeys.has(ref.key));
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedKeys.has(ref.key);
    checkbox.disabled = locked || Boolean(activeCapture) || Boolean(activeArchive);
    checkbox.addEventListener("change", () => {
      selection = toggleConversationSelection(selection, ref, checkbox.checked);
      scheduleSelectionSave();
      renderSelection();
      renderAvailable();
    });
    const copy = document.createElement("span");
    copy.className = "conversation-copy";
    const title = document.createElement("strong");
    title.textContent = ref.title;
    const meta = document.createElement("span");
    const collection = ref.collectionRefs?.[0]?.title;
    meta.textContent = `${formatTime(ref.updatedAt)} · ${ref.providerLabel || ref.provider}${collection ? ` · ${collection}` : ""} · ${ref.isArchived ? "Archived" : ref.primaryCollectionId ? "Project" : "Chat"}`;
    const provider = document.createElement("span");
    provider.className = "conversation-provider";
    provider.textContent = ref.providerLabel || ref.provider;
    copy.append(title, meta);
    const badge = document.createElement("span");
    badge.className = "conversation-badge";
    badge.textContent = ref.providerLabel || ref.provider;
    copy.prepend(provider);
    label.append(checkbox, copy, badge);
    fragment.append(label);
  }
  elements["conversation-list"].append(fragment);
  elements["catalog-render-meta"].textContent = `当前显示 ${renderedRefs.length}/${visibleRefs.length} 条，避免一次渲染过多导致卡顿`;
  elements["load-more-conversations"].hidden = renderedRefs.length >= visibleRefs.length;
  renderTask();
}

function renderSelection() {
  elements["selected-count"].textContent = String(selection.items.length);
  elements["selected-list"].textContent = "";
  if (!selection.items.length) {
    elements["selected-list"].innerHTML = '<div class="empty">还没有选择会话。你的选择会自动保存在本地。</div>';
    renderTask();
    return;
  }
  const locked = selectionLocked();
  const preview = selection.items.slice(0, SELECTION_PREVIEW_LIMIT);
  const fragment = document.createDocumentFragment();
  for (const ref of preview) {
    const row = document.createElement("div");
    row.className = "selected-item";
    const title = document.createElement("span");
    title.textContent = ref.title;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "移除";
    remove.disabled = locked || Boolean(activeCapture) || Boolean(activeArchive);
    remove.addEventListener("click", () => {
      selection = toggleConversationSelection(selection, ref, false);
      scheduleSelectionSave();
      renderSelection();
      renderAvailable();
    });
    row.append(title, remove);
    fragment.append(row);
  }
  if (selection.items.length > preview.length) {
    const summary = document.createElement("div");
    summary.className = "empty";
    summary.textContent = `为保持流畅，仅预览前 ${preview.length} 条；当前批次实际包含 ${selection.items.length} 条。`;
    fragment.append(summary);
  }
  elements["selected-list"].append(fragment);
  renderTask();
}

async function restoreBasketState() {
  restoreUiPreferences();
  const [savedSelections, cachedCatalogs] = await Promise.all([
    selectionStore.list().catch(() => []),
    // Replaces catalogStore.getLatest("chatgpt") so every real cached provider remains visible.
    catalogStore.list().catch(() => []),
  ]);
  if (savedSelections[0]) {
    selection = createConversationSelectionSet(savedSelections[0]);
    elements["selection-title"].value = selection.title;
  }
  await loadCurrentJob();
  const cachedCatalog = buildBasketCatalog(cachedCatalogs);
  if (cachedCatalog.conversations.length) {
    populateCatalogView(cachedCatalog, { cachedAt: cachedCatalogs[0]?.cachedAt ?? null });
    setStatus(`已恢复上次会话目录和 ${selection.items.length} 条选择。需要最新目录时再点“刷新会话目录”。`, "success");
  } else if (selection.items.length) {
    setStatus(`已恢复 ${selection.items.length} 条上次选择；刷新目录后可以继续增删。`, "success");
  }
  renderSelection();
  renderAvailable();
  renderTask();
}

async function loadCatalog() {
  if (catalogBusy || activeCapture || activeArchive) return;
  catalogBusy = true;
  elements.load.disabled = true;
  taskFeedback.start({
    id: "basket-catalog",
    title: "正在刷新会话目录",
    detail: "连接 ChatGPT，读取普通、归档与 Project 会话，并更新本地缓存。",
    stage: "连接 ChatGPT",
    step: 0,
    stepLabels: ["连接", "扫描", "核验", "可选择"],
    button: elements.load,
    buttonLabel: "正在刷新…",
    anchor: document.querySelector(".conversation-panel"),
    indeterminate: true,
  });
  setStatus("正在刷新普通、归档和项目会话目录……", "warning");
  setProgress({ phase: "INDEXING", title: "刷新会话目录", current: 0, total: 1 });
  renderTask();
  try {
    const tab = await findChatGPTTab();
    if (!tab?.id) throw new Error("请先打开并登录 ChatGPT，再刷新会话目录。");
    const transport = createChatGPTTransport(tab.id);
    const freshCatalog = await loadChatGPTConversationCatalog({
      transport,
      onProgress(event) {
        elements["catalog-summary"].textContent = `已发现 ${event.count ?? 0} 条会话${event.projects ? ` · ${event.projects} 个项目` : ""}`;
        setProgress({ phase: "INDEXING", title: "刷新会话目录", current: Math.max(1, event.count ?? 1), total: Math.max(1, event.count ?? 1) });
      },
    });
    const cached = await catalogStore.put(freshCatalog).catch((error) => {
      log(`目录缓存失败：${error instanceof Error ? error.message : String(error)}`);
      return { cachedAt: new Date().toISOString() };
    });
    const aggregate = buildBasketCatalog(await catalogStore.list());
    populateCatalogView(aggregate, { cachedAt: cached.cachedAt });
    if (!selectionLocked()) {
      selection = selectionForSave();
      await selectionStore.put(selection);
    }
    setStatus("会话目录已刷新并缓存在本地。勾选变化会自动保存。", "success");
    setProgress({ phase: "READY", title: "可以选择", current: 1, total: 1 });
    taskFeedback.success({ title: "会话目录已更新", detail: `已读取 ${catalog.refs.length} 条会话，可以开始选择。`, button: elements.load });
    log(`目录刷新完成：${freshCatalog.conversations.length} 条会话`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (catalog) {
      setStatus(`刷新失败，仍保留本地缓存：${message}`, "warning");
      setProgress({ phase: "CACHED", title: "继续使用本地缓存", current: 1, total: 1 });
      taskFeedback.pause({ title: "刷新失败，已保留缓存", detail: "当前仍可使用上一次会话目录；稍后可重新刷新。", button: elements.load });
    } else {
      setStatus(message, "error");
      setProgress({ phase: "ERROR", title: "读取失败", current: 0, total: 1 });
      taskFeedback.fail({ title: "会话目录读取失败", detail: error instanceof Error ? error.message : String(error), button: elements.load });
    }
  } finally {
    catalogBusy = false;
    elements.load.disabled = false;
    renderSelection();
    renderAvailable();
  }
}

async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

function progressFromEvent(event) {
  currentJob = event.job;
  const counts = taskCounts(event.job);
  if (event.type === "conversation-start") {
    setProgress({ phase: "CAPTURING", title: event.metadata.title, current: counts.saved, total: counts.selected });
  } else if (event.type === "conversation-complete") {
    setProgress({ phase: "CAPTURING", title: event.metadata.title, current: counts.saved, total: counts.selected });
    log(`已保存：${event.metadata.title}`);
  } else if (event.type === "conversation-failed") {
    log(`失败：${event.metadata.title} · ${event.error?.message ?? event.error}`);
  } else if (event.type === "retry") {
    log(`当前会话请求受限或超时，${Math.ceil((event.delay ?? 0) / 1000)} 秒后重试`);
  } else if (event.type === "asset-indexing" || event.type === "asset-indexing-progress") {
    setProgress({ phase: "ASSETS", title: "整理已保存会话的附件引用", current: event.index ?? 0, total: event.total ?? Math.max(1, counts.saved) });
  } else if (event.type === "asset-start") {
    setProgress({ phase: "ASSETS", title: event.asset?.fileName || "下载附件", current: event.index - 1, total: event.total });
  } else if (event.type === "job-complete") {
    setProgress({ phase: "READY", title: "采集完成，等待导出", current: counts.saved, total: counts.selected });
  }
  renderTask(event.job);
}

async function runCapture() {
  if (activeCapture || activeArchive || catalogBusy) return;
  const eligibility = captureEligibility(selection.items);
  if (!eligibility.eligible) {
    setStatus(eligibility.reason, "warning");
    return;
  }
  await saveSelectionNow();
  await loadCurrentJob();
  if (currentJob && !selectionMatchesJob(currentJob)) {
    setStatus("当前选择和旧采集任务不一致。请点击“新建选择批次”，避免混合两批进度。", "error");
    renderTask();
    return;
  }
  captureControl.paused = false;
  pendingExportAfterPause = false;
  taskFeedback.start({
    id: "basket-capture",
    title: "正在采集所选会话",
    detail: "每完成一条就立即写入浏览器本地资料库；暂停不会丢失已保存成果。",
    stage: "准备采集",
    step: 0,
    stepLabels: ["准备", "逐条采集", "核验落盘", "可导出"],
    current: taskCounts().saved,
    total: Math.max(1, taskCounts().selected),
    button: elements["export-selected"],
    buttonLabel: "正在采集…",
    anchor: taskAnchor,
  });
  setStatus("正在逐条采集到浏览器本地数据库。可以随时暂停，已保存内容不会丢失。", "warning");
  log(taskCounts().saved > 0 ? "继续采集未完成会话" : "开始采集所选会话");
  activeCapture = (async () => {
    const tab = await findChatGPTTab();
    if (!tab?.id) throw new Error("未找到已登录的 ChatGPT 标签页。");
    const transport = createChatGPTTransport(tab.id, {
      workspaceId: catalog?.accountScopeId ?? null,
      workspaceLabel: catalog?.accountScopeLabel ?? "当前空间",
      conversationTimeoutMs: 60_000,
    });
    return runSelectedConversationExport({
      selection,
      store: historyStore,
      transport,
      assetPolicy: elements["asset-policy"].value,
      requestDelayMs: 120,
      maxConversationAttempts: 2,
      control: captureControl,
      onProgress: progressFromEvent,
    });
  })();
  renderSelection();
  let shouldExport = false;
  try {
    currentJob = await activeCapture;
    const counts = taskCounts(currentJob);
    if (currentJob.status === "paused") {
      setStatus(`采集已暂停。已保存 ${counts.saved} 条，剩余 ${counts.remaining} 条；现在可以先导出。`, "warning");
      taskFeedback.pause({ title: "采集已暂停", detail: `已安全保存 ${counts.saved}/${counts.selected} 条，可立即导出或稍后继续。`, button: elements["export-selected"] });
      log(`采集暂停：已保存 ${counts.saved}/${counts.selected} 条`);
    } else {
      setStatus(`采集完成：${counts.saved} 条已保存在浏览器。点击“导出已保存到本地”生成 ZIP。`, "success");
      taskFeedback.success({ title: "会话采集完成", detail: `${counts.saved} 条会话已经写入浏览器本地资料库，可以独立导出。`, button: elements["export-selected"] });
      log(`采集完成：${counts.saved} 条`);
    }
    shouldExport = pendingExportAfterPause && counts.saved > 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, "error");
    taskFeedback.fail({ title: "采集未完成", detail: `${message}。已经落盘的会话仍然保留。`, button: elements["export-selected"] });
    log(`采集中断：${message}`);
    await loadCurrentJob();
  } finally {
    activeCapture = null;
    captureControl.paused = false;
    pendingExportAfterPause = false;
    renderSelection();
    renderAvailable();
    renderTask();
  }
  if (shouldExport) await exportSaved();
}

async function exportSaved() {
  if (activeArchive) return;
  if (activeCapture) {
    pendingExportAfterPause = true;
    captureControl.paused = true;
    setStatus("正在安全暂停：当前会话若仍在响应，会等待它结束，最长约 60 秒；随后立即导出此前已保存成果。", "warning");
    renderTask();
    return;
  }
  await loadCurrentJob();
  const counts = taskCounts(currentJob);
  if (!currentJob || counts.saved <= 0) {
    setStatus("还没有已保存的会话可导出。请先开始采集。", "error");
    return;
  }
  archiveControl.paused = false;
  taskFeedback.start({
    id: "basket-export",
    title: "正在导出已保存会话",
    detail: "只读取浏览器本地成果，规划分卷并提交到 Chrome 下载。",
    stage: "核对已保存数据",
    step: 0,
    stepLabels: ["核对", "打包", "提交下载", "完成"],
    current: 0,
    total: Math.max(1, counts.saved),
    button: elements["export-saved"],
    buttonLabel: "正在导出…",
    anchor: taskAnchor,
  });
  activeArchive = (async () => {
    const generatedAt = new Date();
    setStatus(`正在从浏览器本地数据库读取 ${counts.saved} 条已保存会话并规划 ZIP；不会访问 ChatGPT。`, "warning");
    setProgress({ phase: "PACKING", title: "准备阶段性导出", current: 0, total: Math.max(1, counts.saved) });
    const snapshot = await createSavedHistoryExportSnapshot({ job: currentJob, store: historyStore, generatedAt });
    const plan = await createLowMemoryHistoryArchivePlan({
      store: historyStore,
      job: snapshot,
      generatedAt,
      maxVolumeBytes: ARCHIVE_VOLUME_BYTES,
      onProgress(event) {
        setProgress({ phase: "PACKING", title: event.title || "规划分卷", current: event.index, total: event.total });
      },
    });
    let completedVolumes = 0;
    for (let number = 1; number <= plan.volumeCount; number += 1) {
      if (archiveControl.paused) {
        setStatus(`导出已暂停：已完成 ${completedVolumes}/${plan.volumeCount} 个分卷。浏览器中的采集数据仍然保留。`, "warning");
        taskFeedback.pause({ title: "本地导出已暂停", detail: `已完成 ${completedVolumes}/${plan.volumeCount} 个分卷；浏览器中的会话仍安全保留。`, button: elements["export-saved"] });
        return { paused: true, completedVolumes, totalVolumes: plan.volumeCount, snapshot };
      }
      const volume = await buildLowMemoryHistoryArchiveVolume({
        plan,
        volumeNumber: number,
        store: historyStore,
        job: snapshot,
        onProgress(event) {
          setProgress({ phase: "PACKING", title: event.title || `生成第 ${number} 卷`, current: event.index, total: event.total });
        },
      });
      await downloadBlob(volume.blob, volume.filename);
      completedVolumes += 1;
      log(`已提交本地下载：${volume.filename}`);
    }
    return { paused: false, completedVolumes, totalVolumes: plan.volumeCount, snapshot };
  })();
  renderTask();
  try {
    const result = await activeArchive;
    if (!result.paused) {
      lastExportedCount = result.snapshot.captureProgress.savedCount;
      const progress = result.snapshot.captureProgress;
      setProgress({ phase: "DONE", title: "本地导出完成", current: 1, total: 1 });
      const detail = progress.isPartial
        ? `阶段性成果 ${progress.savedCount}/${progress.selectedTotal} 条，已提交 ${result.totalVolumes} 个 ZIP 下载。`
        : `${progress.savedCount} 条会话已提交 ${result.totalVolumes} 个 ZIP 下载。`;
      setStatus(progress.isPartial
        ? `已导出阶段性成果：${progress.savedCount}/${progress.selectedTotal} 条，共 ${result.totalVolumes} 个 ZIP；剩余会话可稍后继续采集。`
        : `已导出全部 ${progress.savedCount} 条会话，共 ${result.totalVolumes} 个 ZIP。`, "success");
      taskFeedback.success({ title: "本地导出已提交", detail, button: elements["export-saved"] });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`本地导出中断：${message}。浏览器中已保存内容没有丢失。`, "error");
    taskFeedback.fail({ title: "本地导出未完成", detail: `${message}。已保存内容没有丢失，可重新导出。`, button: elements["export-saved"] });
    log(`导出中断：${message}`);
  } finally {
    activeArchive = null;
    archiveControl.paused = false;
    renderSelection();
    renderAvailable();
    renderTask();
  }
}

async function startNewBatch() {
  if (activeCapture || activeArchive) return;
  const counts = taskCounts(currentJob);
  const message = counts.saved > 0
    ? `当前批次已有 ${counts.saved} 条保存在浏览器。新建批次不会删除这些数据，但当前页面将切换到新的空选择集。继续吗？`
    : "确认新建一个空的选择批次？";
  if (!confirm(message)) return;
  selection = createConversationSelectionSet({
    id: `selection-${crypto.randomUUID?.() ?? Date.now()}`,
    title: "我的会话导出",
    provider: "chatgpt",
    accountScopeId: catalog?.accountScopeId ?? null,
    refs: [],
  });
  elements["selection-title"].value = selection.title;
  await selectionStore.put(selection);
  currentJob = null;
  lastExportedCount = 0;
  setStatus("已建立新的空选择批次。旧批次和已保存内容没有被删除。", "success");
  renderSelection();
  renderAvailable();
  setProgress({ phase: "IDLE", title: "等待选择", current: 0, total: 1 });
}

elements.load.addEventListener("click", loadCatalog);
elements.query.addEventListener("input", applyFilters);
elements.provider.addEventListener("change", applyFilters);
elements.collection.addEventListener("change", applyFilters);
elements.scope.addEventListener("change", applyFilters);
elements["asset-policy"].addEventListener("change", persistUiPreferences);
elements["selection-title"].addEventListener("input", scheduleSelectionSave);
elements["load-more-conversations"].addEventListener("click", () => {
  visibleRenderLimit += CATALOG_RENDER_BATCH;
  renderAvailable();
});
elements["select-visible"].addEventListener("click", () => {
  if (selectionLocked()) return;
  const byKey = new Map(selection.items.map((item) => [item.key, item]));
  for (const ref of visibleRefs) byKey.set(ref.key, ref);
  selection = createConversationSelectionSet({ id: selection.id, title: elements["selection-title"].value, provider: null, accountScopeId: null, refs: [...byKey.values()], createdAt: selection.createdAt });
  scheduleSelectionSave();
  renderSelection();
  renderAvailable();
});
elements["clear-selection"].addEventListener("click", () => {
  if (selectionLocked()) return;
  selection = createConversationSelectionSet({ id: selection.id, title: elements["selection-title"].value, provider: null, accountScopeId: null, refs: [], createdAt: selection.createdAt });
  scheduleSelectionSave();
  renderSelection();
  renderAvailable();
});
elements["save-selection"].addEventListener("click", () => saveSelectionNow({ announce: true }).catch((error) => setStatus(error instanceof Error ? error.message : String(error), "error")));
elements["export-selected"].addEventListener("click", () => runCapture().catch((error) => setStatus(error instanceof Error ? error.message : String(error), "error")));
elements["pause-capture"].addEventListener("click", () => {
  if (activeArchive) {
    archiveControl.paused = true;
    taskFeedback.update({ title: "正在安全暂停导出", detail: "当前分卷写盘完成后停止；已完成下载和浏览器数据不会丢失。", stage: "等待当前分卷完成", step: 2, indeterminate: true });
    setStatus("当前分卷完成后暂停导出；采集数据和已完成下载不会丢失。", "warning");
  } else if (activeCapture) {
    captureControl.paused = true;
    taskFeedback.update({ title: "正在安全暂停采集", detail: "当前会话请求结束后停止；已经写入的内容不会丢失。", stage: "等待当前会话完成", step: 2, indeterminate: true });
    setStatus("正在完成当前会话请求，随后暂停。已经保存的会话不会丢失。", "warning");
  }
  renderTask();
});
elements["export-saved"].addEventListener("click", () => exportSaved().catch((error) => setStatus(error instanceof Error ? error.message : String(error), "error")));
elements["new-batch"].addEventListener("click", () => startNewBatch().catch((error) => setStatus(error instanceof Error ? error.message : String(error), "error")));

await restoreBasketState();
await findChatGPTTab();
