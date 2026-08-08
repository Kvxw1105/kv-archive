import { createIndexedDbLibraryStore } from "./library-store.js";
import { importArchivesIntoVault } from "./vault-import.js";
import { buildAgentBundle } from "./agent-bundle.js";
import { createIndexedDbCaptureStore } from "./capture-store.js";
import { createTaskFeedback } from "./task-feedback.js";
import {
  DEFAULT_DETAIL_BATCH,
  DEFAULT_RESULT_BATCH,
  agentBundleScope,
  ignoredAgentBundleFilters,
  pageResultRows,
  partitionDetailMessages,
} from "./library-ux.js";

const store = createIndexedDbLibraryStore();
const captureStore = createIndexedDbCaptureStore();
const taskFeedback = createTaskFeedback({ page: "LOCAL LIBRARY", autoScroll: true });
const taskAnchor = document.querySelector(".library-intro");
const $ = (id) => document.getElementById(id);
const elements = Object.fromEntries([
  "files", "clear", "agent-export", "agent-scope", "import-status", "metric-conversations", "metric-messages",
  "metric-evidence", "metric-imports", "query", "search", "source", "project", "role", "archived", "date-from",
  "date-to", "results-title", "results-summary", "results", "load-more", "detail", "detail-content",
].map((id) => [id, $(id)]));
const roleLabel = { user: "用户", assistant: "助手", system: "系统", tool: "工具", unknown: "未知" };
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const dateText = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : "时间未知";
};

let resultLimit = DEFAULT_RESULT_BATCH;
let currentDetail = null;
let detailLimit = DEFAULT_DETAIL_BATCH;
let searchRequestId = 0;

function setStatus(text, tone = "") {
  elements["import-status"].textContent = text;
  elements["import-status"].dataset.tone = tone;
}

function filters(limit = resultLimit + DEFAULT_RESULT_BATCH + 1) {
  return {
    query: elements.query.value.trim(),
    sourceKind: elements.source.value,
    projectId: elements.project.value,
    role: elements.role.value,
    archived: elements.archived.value,
    dateFrom: elements["date-from"].value,
    dateTo: elements["date-to"].value,
    limit,
  };
}

function updateAgentScope() {
  const current = filters();
  const ignored = ignoredAgentBundleFilters(current);
  const parts = [
    current.projectId !== "all" ? `Project：${elements.project.selectedOptions[0]?.textContent || current.projectId}` : "全部 Project",
    current.archived === "active" ? "未归档" : current.archived === "archived" ? "已归档" : "全部状态",
    current.dateFrom || current.dateTo ? `${current.dateFrom || "最早"} 至 ${current.dateTo || "现在"}` : "全部日期",
  ];
  elements["agent-scope"].textContent = `接力包范围：${parts.join(" · ")}。${ignored.length ? `${ignored.join("、")}只影响屏幕检索，不会裁剪完整对话证据。` : "会保留范围内完整对话证据。"}`;
}

async function refreshStats() {
  const stats = await store.getStats();
  elements["metric-conversations"].textContent = stats.conversations;
  elements["metric-messages"].textContent = stats.messages;
  elements["metric-evidence"].textContent = stats.evidence;
  elements["metric-imports"].textContent = stats.imports;
  // Use the shared Project catalog so note-only Projects are available for
  // Agent export and filtering, even before they have an imported conversation.
  const projects = await store.listStateProjects();
  const current = elements.project.value;
  elements.project.innerHTML = '<option value="all">全部</option>' + projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.title)}</option>`).join("");
  if ([...elements.project.options].some((option) => option.value === current)) elements.project.value = current;
  updateAgentScope();
}

function snippet(text, query) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!query) return clean.slice(0, 340);
  const index = clean.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, index - 90);
  return `${start > 0 ? "…" : ""}${clean.slice(start, start + 360)}${start + 360 < clean.length ? "…" : ""}`;
}

function resultCard(item, query, isNew = false) {
  const conversation = item.conversation || item;
  const message = item.message;
  const meta = [
    conversation.projectTitle ? `Project · ${conversation.projectTitle}` : conversation.archived ? "归档" : "普通会话",
    dateText(conversation.updatedAt || conversation.createdAt),
    ...(conversation.sourceKinds || []),
  ];
  return `<button class="result" data-key="${escapeHtml(conversation.key)}" data-new="${isNew}"><div class="result-header"><div><h3>${escapeHtml(conversation.title)}</h3><div class="meta">${meta.map(escapeHtml).join(" · ")}</div></div>${message ? `<span class="role">${escapeHtml(roleLabel[message.role] || message.role)}</span>` : ""}</div>${message ? `<p class="snippet">${escapeHtml(snippet(message.text, query))}</p>` : `<p class="snippet">${conversation.messageCount || 0} 条可搜索消息，${conversation.activeMessageCount || 0} 条位于当前分支。</p>`}</button>`;
}

async function runSearch({ keepPosition = false } = {}) {
  const requestId = ++searchRequestId;
  const current = filters();
  elements.search.disabled = true;
  elements["load-more"].disabled = true;
  elements.results.setAttribute("aria-busy", "true");
  if (!keepPosition) elements.results.innerHTML = '<div class="empty">正在读取本地索引并整理结果……</div>';
  taskFeedback.start({
    id: "library-search",
    title: "正在搜索本地资料库",
    detail: current.query ? `正在查找“${current.query}”并整理匹配结果。` : "正在读取最近对话。",
    stage: "查询本地索引",
    step: 0,
    stepLabels: ["查询", "匹配", "排序", "显示"],
    button: keepPosition ? elements["load-more"] : elements.search,
    buttonLabel: keepPosition ? "正在加载…" : "搜索中…",
    anchor: elements.results,
    indeterminate: true,
  });
  try {
    const data = await store.search(current);
    if (requestId !== searchRequestId) return;
    const rows = current.query ? data.results : data.conversations;
    const page = pageResultRows(rows, resultLimit);
    taskFeedback.update({ stage: "整理匹配结果", step: 2, current: page.visible.length, total: Math.max(page.visible.length, 1), detail: `已整理 ${page.visible.length} 项结果。` });
    elements["results-title"].textContent = current.query ? `搜索“${current.query}”` : "最近对话";
    elements["results-summary"].textContent = page.hasMore ? `已显示 ${page.visible.length} 项，还有更多结果可继续加载` : `共显示 ${page.visible.length} 项`;
    elements.results.innerHTML = page.visible.length
      ? page.visible.map((row, index) => resultCard(row, current.query, keepPosition && index >= resultLimit - DEFAULT_RESULT_BATCH)).join("")
      : '<div class="empty"><strong>没有匹配结果</strong><span>可调整关键词、来源、Project、角色或日期。</span><div class="empty-actions"><button type="button" data-library-action="clear-filters">清除筛选</button><button type="button" class="secondary" data-library-action="import">导入备份</button></div></div>';
    elements["load-more"].hidden = !page.hasMore;
    elements["load-more"].textContent = page.hasMore ? `再加载 ${page.nextCount} 项` : "没有更多结果";
    taskFeedback.success({ title: "资料库搜索完成", detail: `已显示 ${page.visible.length} 项结果。`, button: keepPosition ? elements["load-more"] : elements.search });
    if (!keepPosition) elements["results-title"].scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    if (requestId !== searchRequestId) return;
    const message = error instanceof Error ? error.message : String(error);
    elements.results.innerHTML = `<div class="empty"><strong>搜索失败</strong><span>${escapeHtml(message)}</span><div class="empty-actions"><button type="button" data-library-action="retry">重试</button></div></div>`;
    elements["load-more"].hidden = true;
    taskFeedback.fail({ title: "资料库搜索失败", detail: message, button: keepPosition ? elements["load-more"] : elements.search });
  } finally {
    if (requestId === searchRequestId) {
      elements.search.disabled = false;
      elements["load-more"].disabled = false;
      elements.results.removeAttribute("aria-busy");
    }
  }
}

function renderMessage(message) {
  return `<section class="message" data-active="${message.activePath}"><header><span>${escapeHtml(roleLabel[message.role] || message.role)}${message.activePath ? "" : " · 历史分支"}</span><time>${escapeHtml(dateText(message.createdAt))}</time></header><pre>${escapeHtml(message.text)}</pre></section>`;
}

function renderCurrentDetail() {
  if (!currentDetail) return;
  const { conversation } = currentDetail;
  const page = partitionDetailMessages(currentDetail.messages, detailLimit);
  elements["detail-content"].innerHTML = `<div class="detail-shell"><h2>${escapeHtml(conversation.title)}</h2><div class="detail-meta">${escapeHtml(conversation.projectTitle ? `Project · ${conversation.projectTitle}` : conversation.archived ? "归档会话" : "普通会话")} · ${escapeHtml(dateText(conversation.updatedAt || conversation.createdAt))} · ${currentDetail.messages.length} 条消息</div><div class="detail-progress"><span>已显示 ${page.shown}/${page.total} 条；长对话按批加载，避免页面卡死。</span>${page.hasMore ? `<button type="button" class="secondary" data-detail-more>再加载 ${Math.min(DEFAULT_DETAIL_BATCH, page.total - page.shown)} 条</button>` : ""}</div>${page.visibleActive.map(renderMessage).join("")}${page.visibleBranch.length ? `<h3>其他历史分支</h3>${page.visibleBranch.map(renderMessage).join("")}` : ""}${!page.hasMore ? '<div class="evidence-note">当前视图来自独立搜索索引。原始 Canonical Conversation 和原始导出证据保存在 vault-evidence 中，索引重建不会改写证据。</div>' : ""}</div>`;
}

async function openDetail(key) {
  currentDetail = null;
  detailLimit = DEFAULT_DETAIL_BATCH;
  elements["detail-content"].innerHTML = '<div class="detail-shell"><h2>正在读取对话</h2><div class="detail-meta">正在从本地资料库读取消息并整理分支……</div></div>';
  elements.detail.showModal();
  taskFeedback.start({ id: "library-detail", title: "正在打开对话详情", detail: "读取会话、消息和历史分支。", stage: "读取本地会话", step: 0, stepLabels: ["读取", "整理", "渲染", "完成"], anchor: elements["detail-content"], indeterminate: true });
  try {
    const detail = await store.getConversationDetail(key);
    if (!detail) throw new Error("未找到该对话");
    currentDetail = detail;
    taskFeedback.update({ stage: "分批渲染消息", step: 2, current: Math.min(detail.messages.length, detailLimit), total: Math.max(detail.messages.length, 1), detail: `共读取 ${detail.messages.length} 条消息，首批显示 ${Math.min(detail.messages.length, detailLimit)} 条。` });
    renderCurrentDetail();
    taskFeedback.success({ title: "对话详情已打开", detail: `共 ${detail.messages.length} 条消息；可以按批继续加载。` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    elements["detail-content"].innerHTML = `<div class="detail-shell"><h2>无法打开对话</h2><div class="detail-meta">${escapeHtml(message)}</div></div>`;
    taskFeedback.fail({ title: "对话详情读取失败", detail: message });
  }
}

async function importFiles(fileList) {
  const files = [];
  for (const file of fileList) files.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  if (!files.length) return;
  elements.files.disabled = true;
  taskFeedback.start({ id: "library-import", title: "正在导入资料库", detail: `读取 ${files.length} 个备份文件，校验后建立独立搜索索引。`, stage: "读取文件", step: 0, stepLabels: ["读取", "索引", "核验", "可搜索"], current: 0, total: files.length, anchor: taskAnchor });
  setStatus(`正在读取 ${files.length} 个文件……`);
  try {
    const report = await importArchivesIntoVault({
      files,
      store,
      onProgress: (event) => {
        if (event.phase === "indexing") {
          setStatus(`正在索引 ${event.index}/${event.total}：${event.title}`);
          taskFeedback.update({ title: "正在建立搜索索引", detail: event.title || "逐条索引会话与消息", stage: "索引内容", step: 1, current: event.index, total: event.total, anchor: taskAnchor });
        }
      },
    });
    const resultText = `新增 ${report.inserted}，更新 ${report.updated}，重复 ${report.duplicate}，失败 ${report.failed}`;
    setStatus(`导入完成：新增 ${report.inserted}，更新 ${report.updated}，重复跳过 ${report.duplicate}，旧版本保留 ${report.stale}，失败 ${report.failed}。`, report.failed ? "error" : "success");
    if (report.failed) taskFeedback.fail({ title: "资料库导入部分失败", detail: resultText });
    else taskFeedback.success({ title: "资料库导入完成", detail: `${resultText}；现在可以搜索和打开会话。` });
    await refreshStats();
    resultLimit = DEFAULT_RESULT_BATCH;
    await runSearch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, "error");
    taskFeedback.fail({ title: "资料库导入失败", detail: message });
  } finally {
    elements.files.disabled = false;
    elements.files.value = "";
  }
}

async function clearLibrary() {
  if (!confirm("确认清空可搜索会话索引？这不会删除 Project State、项目上下文、记录中心、Memory Gate 回执、原 AI 平台内容或已下载文件。")) return;
  taskFeedback.start({ id: "library-clear", title: "正在清空会话索引", detail: "只删除可搜索会话、消息和导入记录；Evidence 与其他项目数据保持不变。", stage: "删除本地索引", step: 1, button: elements.clear, buttonLabel: "正在清空…", anchor: taskAnchor, indeterminate: true });
  try {
    await store.clear();
    setStatus("可搜索会话索引已清空；Evidence、Project State、项目上下文和记录中心仍保留。", "success");
    await refreshStats();
    resultLimit = DEFAULT_RESULT_BATCH;
    await runSearch();
    taskFeedback.success({ title: "会话索引已清空", detail: "Evidence、Project State、项目上下文、记录中心、回执和已下载文件均未删除。", button: elements.clear });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, "error");
    taskFeedback.fail({ title: "清空未完成", detail: message, button: elements.clear });
  }
}

async function exportAgentBundle() {
  const button = elements["agent-export"];
  const current = filters();
  const ignored = ignoredAgentBundleFilters(current);
  if (ignored.length && !confirm(`${ignored.join("、")}只用于屏幕检索，不会裁剪 Agent 接力包。接力包将保留当前 Project、日期、来源和归档范围内的完整对话证据。继续导出？`)) return;
  const scope = agentBundleScope(current);
  taskFeedback.start({ id: "library-agent-export", title: "正在生成 Agent 接力包", detail: "读取明确范围内的完整对话证据、状态和内容记录。", stage: "读取资料库", step: 0, stepLabels: ["读取", "整理", "打包", "完成"], button, buttonLabel: "正在生成…", anchor: taskAnchor, indeterminate: true });
  setStatus("正在整理只读 Agent 接力包……");
  try {
    const records = await store.exportAgentRecords(scope);
    const captureRecords = await captureStore.exportRecords(scope);
    Object.assign(records, captureRecords);
    if (!records.conversations.length && !records.contentObjects.length) throw new Error("当前接力范围没有可导出的对话或记录");
    const bundle = await buildAgentBundle(records, { filters: scope, sourceAppVersion: chrome.runtime.getManifest().version });
    const blob = new Blob([bundle.bytes], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({ url, filename: bundle.filename, saveAs: true });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    setStatus(`已生成 Agent 接力包：${records.conversations.length} 条对话，${records.messages.length} 条消息，${records.contentObjects.length} 条记录。`, "success");
    taskFeedback.success({ title: "Agent 接力包已生成", detail: `${records.conversations.length} 条完整对话、${records.messages.length} 条消息和 ${records.contentObjects.length} 条记录已提交下载。`, button });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, "error");
    taskFeedback.fail({ title: "Agent 接力包生成失败", detail: message, button });
  } finally {
    button.disabled = false;
  }
}

elements.files.addEventListener("change", () => importFiles(elements.files.files));
elements.search.addEventListener("click", () => { resultLimit = DEFAULT_RESULT_BATCH; runSearch(); });
elements.query.addEventListener("keydown", (event) => { if (event.key === "Enter") { resultLimit = DEFAULT_RESULT_BATCH; runSearch(); } });
elements.query.addEventListener("input", updateAgentScope);
for (const id of ["source", "project", "role", "archived", "date-from", "date-to"]) {
  elements[id].addEventListener("change", () => { resultLimit = DEFAULT_RESULT_BATCH; updateAgentScope(); runSearch(); });
}
elements["load-more"].addEventListener("click", async () => { resultLimit += DEFAULT_RESULT_BATCH; await runSearch({ keepPosition: true }); });
elements.results.addEventListener("click", (event) => {
  const result = event.target.closest("button.result[data-key]");
  if (result) { openDetail(result.dataset.key); return; }
  const action = event.target.closest("[data-library-action]")?.dataset.libraryAction;
  if (action === "import") elements.files.click();
  else if (action === "retry") runSearch();
  else if (action === "clear-filters") {
    elements.query.value = "";
    elements.source.value = "all";
    elements.project.value = "all";
    elements.role.value = "all";
    elements.archived.value = "all";
    elements["date-from"].value = "";
    elements["date-to"].value = "";
    resultLimit = DEFAULT_RESULT_BATCH;
    updateAgentScope();
    runSearch();
  }
});
elements["detail-content"].addEventListener("click", (event) => {
  if (!event.target.closest("[data-detail-more]")) return;
  detailLimit += DEFAULT_DETAIL_BATCH;
  renderCurrentDetail();
});
elements.detail.addEventListener("close", () => { currentDetail = null; detailLimit = DEFAULT_DETAIL_BATCH; });
elements.clear.addEventListener("click", clearLibrary);
elements["agent-export"].addEventListener("click", exportAgentBundle);

await refreshStats();
await runSearch();
