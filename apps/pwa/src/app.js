import { createIndexedDbCaptureStore } from "./capture-store.js";
import {
  buildPortableCapturePackage,
  createPortableCaptureZipBlob,
  readPortableCaptureZip,
} from "./capture-package.js";
import {
  KIND_LABELS,
  buildCaptureInput,
  collectProjects,
  filterTimeline,
  groupTimeline,
  parseTags,
  previewText,
  relativeTime,
  slugifyProject,
} from "./mobile-core.js";
import { createDebouncedWriter, createDraftStore, hasMeaningfulDraft } from "./draft-store.js";

const VERSION = "0.16.11";
const store = createIndexedDbCaptureStore();
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const elements = Object.fromEntries([
  "timeline", "timeline-count", "timeline-query", "filter-project", "filter-kind", "filter-status", "filters", "filter-toggle",
  "capture-form", "capture-body", "capture-kind", "capture-project", "capture-name", "capture-tags", "capture-source", "capture-draft-status", "capture-status", "capture-reset",
  "project-list", "quick-add", "offline-badge", "install-button", "display-mode", "network-state", "sync-state",
  "export-project", "export-button", "import-file", "analyze-button", "import-plan", "apply-button", "recovery-list", "tools-status",
  "mobile-task", "mobile-task-title", "mobile-task-percent", "mobile-task-detail", "mobile-task-bar", "mobile-task-stage", "mobile-task-count",
  "detail-dialog", "detail-content", "edit-dialog", "edit-form", "edit-id", "edit-revision", "edit-title", "edit-body", "edit-project", "edit-tags", "edit-cancel",
].map((id) => [id, $(id)]));

let allItems = [];
let projects = [];
let currentDetailData = null;
let detailVersionLimit = 50;
let detailOperationLimit = 30;
let detailRelationLimit = 30;
let installPrompt = null;
let pendingPackage = null;
let pendingPlan = null;
let timelineLimit = 80;
const captureDraftStore = createDraftStore({ storage: localStorage, key: "kv-archive:pwa-capture-draft:v1" });
const RELATION_LABELS = { related_to: "相关", supports: "支持", depends_on: "依赖", derived_from: "源自", references: "引用", contains: "包含", supersedes: "替代", promoted_to: "晋升为", belongs_to: "属于" };


function startMobileTask({title,detail,stage="准备",current=null,total=null,indeterminate=true}={}){
  elements["mobile-task"].classList.remove("hidden");
  elements["mobile-task"].dataset.indeterminate=indeterminate?"true":"false";
  elements["mobile-task-title"].textContent=title||"正在处理";
  elements["mobile-task-detail"].textContent=detail||"请稍候。";
  updateMobileTask({stage,current,total,indeterminate});
}
function updateMobileTask({title,detail,stage,current,total,indeterminate}={}){
  if(title)elements["mobile-task-title"].textContent=title;if(detail)elements["mobile-task-detail"].textContent=detail;if(stage)elements["mobile-task-stage"].textContent=stage;
  const countable=Number.isFinite(Number(current))&&Number.isFinite(Number(total))&&Number(total)>0;
  const percent=countable?Math.max(0,Math.min(100,Number(current)/Number(total)*100)):null;
  elements["mobile-task"].dataset.indeterminate=(indeterminate??!countable)?"true":"false";
  elements["mobile-task-count"].textContent=countable?`${current}/${total}`:"";elements["mobile-task-percent"].textContent=percent===null?"运行中":`${Math.round(percent)}%`;elements["mobile-task-bar"].style.width=percent===null?"36%":`${percent}%`;
}
function finishMobileTask({title,detail,error=false}={}){elements["mobile-task"].dataset.indeterminate="false";elements["mobile-task-title"].textContent=title|| (error?"操作未完成":"操作完成");elements["mobile-task-detail"].textContent=detail||"";elements["mobile-task-stage"].textContent=error?"需要处理":"已完成";if(!error){elements["mobile-task-percent"].textContent="100%";elements["mobile-task-bar"].style.width="100%";}}

function setStatus(target, message = "", tone = "") {
  target.textContent = message;
  target.className = `inline-status${tone ? ` ${tone}` : ""}`;
}

function showView(name) {
  const target = new Set(["timeline", "capture", "tools"]).has(name) ? name : "timeline";
  name = target;
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === name));
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.target === name));
  elements["quick-add"].classList.toggle("hidden", name === "capture");
  if (name === "capture") setTimeout(() => elements["capture-body"].focus(), 60);
  history.replaceState(null, "", `#${name}`);
}

function projectOptions(selected = "all") {
  const core = [
    `<option value="all"${selected === "all" ? " selected" : ""}>全部</option>`,
    `<option value="unbound"${selected === "unbound" ? " selected" : ""}>未绑定</option>`,
  ];
  return core.concat(projects.map((project) => `<option value="${escapeHtml(project.id)}"${selected === project.id ? " selected" : ""}>${escapeHtml(project.title)}</option>`)).join("");
}

function validateProjectTitle(value) {
  const title = String(value || "").trim();
  if (!title) return null;
  const id = slugifyProject(title);
  const existing = projects.find((project) => project.id === id);
  if (!existing) return title;
  if (existing.title.normalize("NFKC").toLocaleLowerCase() !== title.normalize("NFKC").toLocaleLowerCase()) {
    throw new Error(`Project 名称“${title}”与现有“${existing.title}”产生相同标识，请换一个更具体的名称。`);
  }
  return existing.title;
}

function refreshProjectControls() {
  const filterValue = elements["filter-project"].value || "all";
  const exportValue = elements["export-project"].value || "all";
  elements["filter-project"].innerHTML = projectOptions(filterValue);
  elements["export-project"].innerHTML = projectOptions(exportValue);
  elements["project-list"].innerHTML = projects.map((project) => `<option value="${escapeHtml(project.title)}"></option>`).join("");
}

function card(item) {
  const statusLabel = item.status === "archived" ? "已归档" : item.status === "trashed" ? "回收站" : KIND_LABELS[item.kind] || item.kind;
  const actions = item.status === "trashed"
    ? `<button data-action="restore" data-id="${escapeHtml(item.id)}">恢复</button>`
    : item.status === "archived"
      ? `<button data-action="edit" data-id="${escapeHtml(item.id)}">编辑</button><button data-action="restore" data-id="${escapeHtml(item.id)}">取消归档</button><button data-action="trash" data-id="${escapeHtml(item.id)}">回收</button>`
      : `<button data-action="edit" data-id="${escapeHtml(item.id)}">编辑</button><button data-action="archive" data-id="${escapeHtml(item.id)}">归档</button><button data-action="trash" data-id="${escapeHtml(item.id)}">回收</button>`;
  return `<article class="note-card" data-id="${escapeHtml(item.id)}">
    <header><div><h3>${escapeHtml(item.title)}</h3><div class="note-meta"><span>${escapeHtml(item.projectTitle || "未绑定 Project")}</span><span>v${item.revision}</span><span>${escapeHtml(relativeTime(item.updatedAt))}</span></div></div><span class="pill">${escapeHtml(statusLabel)}</span></header>
    <p>${escapeHtml(previewText(item.body, 260) || "（无正文）")}</p>
    <div class="note-meta">${(item.tags || []).slice(0, 8).map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join("")}</div>
    <div class="card-actions"><button data-action="detail" data-id="${escapeHtml(item.id)}">详情</button>${actions}</div>
  </article>`;
}

function renderTimeline() {
  const filtered = filterTimeline(allItems, {
    query: elements["timeline-query"].value,
    projectId: elements["filter-project"].value,
    kind: elements["filter-kind"].value,
    status: elements["filter-status"].value,
  });
  elements["timeline-count"].textContent = `${filtered.length} 条`;
  const visible = filtered.slice(0, timelineLimit);
  const groups = groupTimeline(visible);
  const more = filtered.length > visible.length
    ? `<button class="secondary full load-more" data-load-more="true">再加载 ${Math.min(80, filtered.length - visible.length)} 条 · 还剩 ${filtered.length - visible.length} 条</button>`
    : "";
  elements.timeline.innerHTML = groups.length
    ? groups.map((group) => `<section class="day-group"><div class="day-label">${escapeHtml(group.label)}</div>${group.items.map(card).join("")}</section>`).join("") + more
    : `<div class="empty-state"><strong>这里还没有记录</strong><p>按右下角的 ＋，先写下一句。</p></div>`;
}

async function refresh() {
  allItems = await store.list({ status: "all" });
  projects = collectProjects(allItems);
  refreshProjectControls();
  renderTimeline();
  await refreshReceipts();
}

function currentCaptureDraft() {
  return {
    kind: elements["capture-kind"].value,
    projectTitle: elements["capture-project"].value,
    newProjectTitle: elements["capture-project"].value,
    title: elements["capture-name"].value,
    body: elements["capture-body"].value,
    tags: elements["capture-tags"].value,
    sourceUrl: elements["capture-source"].value,
    updatedAt: new Date().toISOString(),
  };
}
function setDraftStatus(message = "草稿会自动保存在此设备。", tone = "") {
  elements["capture-draft-status"].textContent = message;
  elements["capture-draft-status"].className = `draft-status${tone ? ` ${tone}` : ""}`;
}
const captureDraftWriter = createDebouncedWriter((value) => {
  try {
    const saved = captureDraftStore.save(value);
    if (saved) setDraftStatus(`草稿已自动保存 · ${new Date(saved.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`, "success");
    else setDraftStatus();
  } catch (error) {
    setDraftStatus(`草稿保存失败：${error instanceof Error ? error.message : String(error)}`, "warning");
    return null;
  }
}, 320);
function clearCaptureDraft() { captureDraftWriter.cancel(); captureDraftStore.clear(); setDraftStatus(); }
function resetCapture({ clearDraft = true, preserveProjectTitle = "" } = {}) {
  elements["capture-form"].reset();
  elements["capture-kind"].value = "flash";
  elements["capture-project"].value = preserveProjectTitle;
  setStatus(elements["capture-status"], "");
  if (clearDraft) clearCaptureDraft();
}
function restoreCaptureDraft() {
  const draft = captureDraftStore.load();
  if (!draft) return;
  elements["capture-kind"].value = draft.kind || "flash";
  elements["capture-project"].value = draft.projectTitle || "";
  elements["capture-name"].value = draft.title || "";
  elements["capture-body"].value = draft.body || "";
  elements["capture-tags"].value = draft.tags || "";
  elements["capture-source"].value = draft.sourceUrl || "";
  setDraftStatus("已恢复上次未保存的草稿。", "warning");
}

async function saveCapture(event) {
  event.preventDefault();
  try {
    const projectTitle = validateProjectTitle(elements["capture-project"].value);
    const input = buildCaptureInput({
      body: elements["capture-body"].value,
      kind: elements["capture-kind"].value,
      projectTitle,
      title: elements["capture-name"].value,
      tags: elements["capture-tags"].value,
      sourceUrl: elements["capture-source"].value,
    });
    await store.create(input, { actor: "notes-pwa" });
    clearCaptureDraft();
    resetCapture({ preserveProjectTitle: input.projectTitle || "" });
    await refresh();
    setStatus(elements["capture-status"], "已保存到此设备。", "success");
    if (navigator.vibrate) navigator.vibrate(12);
    setTimeout(() => showView("timeline"), 280);
  } catch (error) {
    setStatus(elements["capture-status"], error instanceof Error ? error.message : String(error), "error");
  }
}

function renderMobileDetail() {
  if (!currentDetailData) return;
  const { item, versions, operations, relations } = currentDetailData;
  const visibleVersions = versions.slice(0, detailVersionLimit);
  const visibleOperations = operations.slice(0, detailOperationLimit);
  const visibleRelations = relations.slice(0, detailRelationLimit);
  elements["detail-content"].innerHTML = `
    <span class="eyebrow">${escapeHtml(KIND_LABELS[item.kind] || item.kind)}</span>
    <h2>${escapeHtml(item.title)}</h2>
    <div class="note-meta"><span>${escapeHtml(item.projectTitle || "未绑定 Project")}</span><span>v${item.revision}</span><span>${escapeHtml(item.contentHash)}</span></div>
    <pre>${escapeHtml(item.body)}</pre>
    <h3>版本历史 · ${versions.length}</h3>
    ${visibleVersions.map((version) => `<div class="version-row"><span>v${version.revision} · ${escapeHtml(version.reason)} · ${escapeHtml(relativeTime(version.createdAt))}</span>${version.revision !== item.revision ? `<button class="secondary" data-restore-version="${version.revision}" data-id="${escapeHtml(item.id)}">恢复</button>` : ""}</div>`).join("")}
    ${versions.length > detailVersionLimit ? `<button type="button" class="secondary" data-detail-versions-more>再加载 ${Math.min(50, versions.length - detailVersionLimit)} 个版本</button>` : ""}
    <details><summary>操作日志 · ${operations.length}</summary>
      ${visibleOperations.length ? visibleOperations.map((row) => `<div class="version-row"><span>${escapeHtml(row.type)} · → v${row.resultingRevision ?? "—"} · ${escapeHtml(relativeTime(row.createdAt))}</span></div>`).join("") : '<p class="muted">暂无操作日志。</p>'}
      ${operations.length > detailOperationLimit ? `<button type="button" class="secondary" data-detail-operations-more>再加载 ${Math.min(30, operations.length - detailOperationLimit)} 条操作</button>` : ""}
    </details>
    <details><summary>关系 · ${relations.length}</summary>
      ${visibleRelations.length ? visibleRelations.map((row) => `<div class="version-row"><span>${escapeHtml(row.fromId)} ${escapeHtml(RELATION_LABELS[row.relation] || row.relation)} ${escapeHtml(row.toId)}</span></div>`).join("") : '<p class="muted">暂无关系。</p>'}
      ${relations.length > detailRelationLimit ? `<button type="button" class="secondary" data-detail-relations-more>再加载 ${Math.min(30, relations.length - detailRelationLimit)} 条关系</button>` : ""}
    </details>`;
}

async function openDetail(id) {
  const item = await store.get(id);
  if (!item) return;
  const [versions, operations, relations] = await Promise.all([
    store.listVersions(id),
    store.listOperations({ objectId: id }),
    store.listRelations(id),
  ]);
  currentDetailData = { item, versions, operations, relations };
  detailVersionLimit = 50;
  detailOperationLimit = 30;
  detailRelationLimit = 30;
  renderMobileDetail();
  elements["detail-dialog"].showModal();
}

async function openEdit(id) {
  const item = await store.get(id);
  if (!item) return;
  elements["edit-id"].value = item.id;
  elements["edit-revision"].value = String(item.revision);
  elements["edit-title"].value = item.title;
  elements["edit-body"].value = item.body;
  elements["edit-project"].value = item.projectTitle || "";
  elements["edit-tags"].value = (item.tags || []).join(", ");
  elements["edit-dialog"].showModal();
}

async function saveEdit(event) {
  event.preventDefault();
  const id = elements["edit-id"].value;
  const revision = Number(elements["edit-revision"].value);
  try {
    const projectTitle = validateProjectTitle(elements["edit-project"].value);
    await store.update(id, {
      title: elements["edit-title"].value,
      body: elements["edit-body"].value,
      projectId: projectTitle ? slugifyProject(projectTitle) : null,
      projectTitle,
      tags: parseTags(elements["edit-tags"].value),
    }, { expectedRevision: revision, actor: "notes-pwa" });
    elements["edit-dialog"].close();
    await refresh();
  } catch (error) {
    alert(error instanceof Error ? error.message : String(error));
  }
}

async function handleTimelineAction(button) {
  const { action, id } = button.dataset;
  if (!id) return;
  if (action === "detail") return openDetail(id);
  if (action === "edit") return openEdit(id);
  if (action === "archive") await store.archive(id, { actor: "notes-pwa" });
  if (action === "trash") {
    const item = await store.get(id);
    if (!confirm(`确认将“${item?.title || "该记录"}”移入回收站？之后可以恢复。`)) return;
    await store.trash(id, { actor: "notes-pwa" });
  }
  if (action === "restore") await store.restore(id, { actor: "notes-pwa" });
  await refresh();
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function exportPackage() {
  const button=elements["export-button"];button.disabled=true;startMobileTask({title:"正在导出恢复包",detail:"读取内容、版本、关系和操作日志。",stage:"读取本地内容"});
  try {
    const selected = elements["export-project"].value;
    const filters = selected === "all" ? {} : selected === "unbound" ? { unbound: true } : { projectId: selected };
    const records = await store.exportRecords(filters);
    const project = projects.find((row) => row.id === selected);
    const scope = selected === "unbound" ? { unbound: true } : selected === "all" ? {} : { projectId: selected };
    updateMobileTask({stage:"生成 Portable Capture",detail:`已读取 ${records.contentObjects.length} 条内容。`});
    const packageValue = await buildPortableCapturePackage(records, { sourceAppVersion: VERSION, scope });
    const blob = createPortableCaptureZipBlob(packageValue);
    const suffix = project?.title || (selected === "unbound" ? "未绑定" : "全部");
    downloadBlob(blob, `KV-Archive-Notes-${suffix}-${new Date().toISOString().slice(0, 10)}.zip`);
    setStatus(elements["tools-status"], `已导出 ${records.contentObjects.length} 条内容。`, "success");finishMobileTask({title:"恢复包已提交下载",detail:`共 ${records.contentObjects.length} 条内容。`});
  } catch (error) {const message=error instanceof Error?error.message:String(error);setStatus(elements["tools-status"],message,"error");finishMobileTask({title:"恢复包导出失败",detail:message,error:true});}finally{button.disabled=false;}
}

function renderPlan(plan) {
  if (!plan) {
    elements["import-plan"].classList.add("hidden");
    elements["apply-button"].classList.add("hidden");
    return;
  }
  elements["import-plan"].classList.remove("hidden");
  elements["import-plan"].innerHTML = `<strong>${plan.canApply ? "可以导入" : "发现冲突，禁止写入"}</strong><br>
    新建内容 ${plan.writeCounts.createObjects} · 快进内容 ${plan.writeCounts.fastForwardObjects} · 新版本 ${plan.writeCounts.addVersions}<br>
    关系 ${plan.writeCounts.addRelations} · 操作 ${plan.writeCounts.addOperations} · 晋升 ${plan.writeCounts.addPromotions}<br>
    ${plan.conflicts.length ? `<span class="muted">${plan.conflicts.slice(0, 8).map((row) => escapeHtml(row.message || row.code)).join("；")}</span>` : "零写入分析通过。"}`;
  elements["apply-button"].classList.toggle("hidden", !plan.canApply);
}

async function analyzeImport() {
  const file = elements["import-file"].files?.[0];if(!file)return;const button=elements["analyze-button"];button.disabled=true;startMobileTask({title:"正在分析恢复包",detail:"只读解析 ZIP、验证哈希和版本链，不会写入。",stage:"读取 ZIP"});
  try {
    pendingPackage = await readPortableCaptureZip(file);
    updateMobileTask({stage:"验证哈希与版本链",detail:"正在检查对象、关系端点和冲突。"});
    pendingPlan = await store.analyzePortablePackage(pendingPackage);
    renderPlan(pendingPlan);
    setStatus(elements["tools-status"], pendingPlan.canApply ? "干运行通过，尚未写入。" : "干运行发现冲突，未写入任何数据。", pendingPlan.canApply ? "success" : "error");finishMobileTask({title:pendingPlan.canApply?"干运行通过":"发现冲突，禁止写入",detail:`计划写入 ${pendingPlan.totalWrites} 条；冲突 ${pendingPlan.conflicts.length} 条。`,error:!pendingPlan.canApply});
  } catch (error) {
    pendingPackage = null;
    pendingPlan = null;
    renderPlan(null);
    const message=error instanceof Error?error.message:String(error);setStatus(elements["tools-status"],message,"error");finishMobileTask({title:"恢复包分析失败",detail:message,error:true});
  }finally{button.disabled=false;}
}

async function applyImport() {
  if (!pendingPackage || !pendingPlan?.canApply) return;
  if (!confirm(`确认写入 ${pendingPlan.totalWrites} 条记录？系统会生成不可覆盖恢复回执。`)) return;
  const button=elements["apply-button"];button.disabled=true;startMobileTask({title:"正在写入恢复包",detail:`计划写入 ${pendingPlan.totalWrites} 条记录，并生成不可覆盖回执。`,stage:"写入本地数据库",current:0,total:pendingPlan.totalWrites,indeterminate:false});
  try {
    const result = await store.applyPortablePackage(pendingPackage, { actor: "notes-pwa" });
    pendingPackage = null;
    pendingPlan = null;
    elements["import-file"].value = "";
    renderPlan(null);
    await refresh();
    setStatus(elements["tools-status"], `导入完成，回执 ${result.receipt.id}。`, "success");finishMobileTask({title:"恢复包导入完成",detail:`回执 ${result.receipt.id}`});
  } catch (error) {
    const message=error instanceof Error?error.message:String(error);setStatus(elements["tools-status"],message,"error");finishMobileTask({title:"恢复包导入失败",detail:message,error:true});
  }finally{button.disabled=false;}
}

async function refreshReceipts() {
  const receipts = await store.listRecoveryReceipts();
  const rolledBack = new Set(receipts.filter((row) => row.type === "rollback" && row.status === "applied").map((row) => row.sourceReceiptId));
  elements["recovery-list"].innerHTML = receipts.length ? receipts.map((receipt) => `<div class="receipt"><strong>${escapeHtml(receipt.type === "import" ? "导入回执" : "回滚回执")}</strong><small>${escapeHtml(relativeTime(receipt.createdAt))} · ${escapeHtml(receipt.status)} · ${escapeHtml(receipt.packageId || "")}</small>${receipt.type === "import" && receipt.status === "applied" && !rolledBack.has(receipt.id) ? `<button class="secondary" data-rollback="${escapeHtml(receipt.id)}">安全回滚</button>` : ""}</div>`).join("") : `<p class="muted">暂无恢复回执。</p>`;
}

async function rollback(receiptId) {
  startMobileTask({title:"正在分析安全回滚",detail:"核对后续编辑、关系和依赖，防止破坏性回滚。",stage:"分析回滚边界"});
  try {
    const plan = await store.analyzePortableRollback(receiptId);
    if (!plan.canRollback) throw new Error(plan.conflicts.map((row) => row.message || row.code).join("；"));
    if (!confirm("确认按该回执回滚？回滚本身也会生成不可覆盖回执。")) {
      finishMobileTask({ title: "已取消回滚", detail: "没有修改任何记录。" });
      return;
    }
    updateMobileTask({stage:"执行精确回滚",detail:"只撤销该回执明确新增或推进的记录。"});
    await store.rollbackPortableImport(receiptId, { actor: "notes-pwa" });
    await refresh();
    setStatus(elements["tools-status"], "回滚完成。", "success");finishMobileTask({title:"安全回滚完成",detail:"回滚回执已经保存。"});
  } catch (error) {
    const message=error instanceof Error?error.message:String(error);setStatus(elements["tools-status"],message,"error");finishMobileTask({title:"无法安全回滚",detail:message,error:true});
  }
}

function updateNetwork() {
  const online = navigator.onLine;
  elements["network-state"].textContent = online ? "在线" : "离线";
  elements["offline-badge"].textContent = online ? "本地优先" : "离线可用";
}

function updateDisplayMode() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  elements["display-mode"].textContent = standalone ? "已安装" : "浏览器";
  elements["install-button"].classList.toggle("hidden", standalone);
  if (!standalone && !installPrompt) elements["install-button"].textContent = "安装说明";
}

async function registerPwa() {
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./sw.js", { scope: "./" }); }
    catch (error) { console.warn("Service worker registration failed", error); }
  }
  if (navigator.storage?.persist) {
    try {
      const persisted = await navigator.storage.persist();
      elements["sync-state"].textContent = persisted ? "持久离线存储" : "仅保存在此设备";
    } catch { /* optional capability */ }
  }
}

document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => showView(button.dataset.target)));
elements["quick-add"].addEventListener("click", () => showView("capture"));
elements["filter-toggle"].addEventListener("click", () => {
  const hidden = elements.filters.classList.toggle("hidden");
  elements["filter-toggle"].setAttribute("aria-expanded", String(!hidden));
});
for (const id of ["timeline-query", "filter-project", "filter-kind", "filter-status"]) elements[id].addEventListener(id === "timeline-query" ? "input" : "change", () => { timelineLimit = 80; renderTimeline(); });
elements["capture-form"].addEventListener("submit", saveCapture);
elements["capture-reset"].addEventListener("click", () => { if (hasMeaningfulDraft(currentCaptureDraft()) && !confirm("确认清空当前未保存内容？")) return; resetCapture(); });
for (const id of ["capture-body", "capture-kind", "capture-project", "capture-name", "capture-tags", "capture-source"]) elements[id].addEventListener(["capture-kind"].includes(id) ? "change" : "input", () => captureDraftWriter.schedule(currentCaptureDraft()));
window.addEventListener("beforeunload", () => { try { captureDraftWriter.flush(currentCaptureDraft()); } catch {} });
elements.timeline.addEventListener("click", (event) => {
  const more = event.target.closest("button[data-load-more]");
  if (more) { timelineLimit += 80; renderTimeline(); return; }
  const button = event.target.closest("button[data-action]");
  if (button) handleTimelineAction(button).catch((error) => alert(error instanceof Error ? error.message : String(error)));
});
elements["detail-content"].addEventListener("click", async (event) => {
  if (event.target.closest("[data-detail-versions-more]")) {
    detailVersionLimit += 50;
    renderMobileDetail();
    return;
  }
  if (event.target.closest("[data-detail-operations-more]")) {
    detailOperationLimit += 30;
    renderMobileDetail();
    return;
  }
  if (event.target.closest("[data-detail-relations-more]")) {
    detailRelationLimit += 30;
    renderMobileDetail();
    return;
  }
  const button = event.target.closest("button[data-restore-version]");
  if (!button) return;
  if (!confirm(`确认从 v${button.dataset.restoreVersion} 生成新的当前版本？历史不会删除。`)) return;
  try {
    await store.restoreVersion(button.dataset.id, Number(button.dataset.restoreVersion), { actor: "notes-pwa" });
    elements["detail-dialog"].close();
    await refresh();
  } catch (error) {
    alert(`版本恢复失败：${error instanceof Error ? error.message : String(error)}`);
  }
});
elements["edit-form"].addEventListener("submit", saveEdit);
elements["edit-cancel"].addEventListener("click", () => elements["edit-dialog"].close());
elements["export-button"].addEventListener("click", exportPackage);
elements["import-file"].addEventListener("change", () => {
  pendingPackage = null; pendingPlan = null; renderPlan(null);
  elements["analyze-button"].disabled = !elements["import-file"].files?.length;
});
elements["analyze-button"].addEventListener("click", analyzeImport);
elements["apply-button"].addEventListener("click", applyImport);
elements["recovery-list"].addEventListener("click", (event) => {
  const button = event.target.closest("button[data-rollback]");
  if (button) rollback(button.dataset.rollback);
});
window.addEventListener("online", updateNetwork);
window.addEventListener("offline", updateNetwork);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  elements["install-button"].classList.remove("hidden");
  elements["install-button"].textContent = "安装";
});
elements["install-button"].addEventListener("click", async () => {
  if (installPrompt) {
    await installPrompt.prompt();
    installPrompt = null;
    elements["install-button"].textContent = "安装说明";
    return;
  }
  showView("tools");
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const message = isIos
    ? "在 Safari 底部点“分享”，再选择“添加到主屏幕”。"
    : "打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。若没有该选项，请确认使用 HTTPS 或本地开发地址。";
  setStatus(elements["tools-status"], message, "warning");
});
window.addEventListener("appinstalled", () => { installPrompt = null; updateDisplayMode(); });

updateNetwork();
updateDisplayMode();
showView(location.hash.slice(1) || "timeline");
restoreCaptureDraft();
await registerPwa();
await refresh();
