import { createIndexedDbLibraryStore } from "./library-store.js";
import { createIndexedDbHistoryStore } from "./history-store.js";
import { createIndexedDbCaptureStore } from "./capture-store.js";
import { DEFAULT_HISTORY_JOB_ID } from "./history-engine.js";
import { buildKnowledgeExportVolume, createKnowledgeExportPlan, resumableKnowledgeRun } from "./knowledge-export.js";
import { summarizeKnowledgeQuality } from "./ux-guidance.js";
import { createTaskFeedback } from "./task-feedback.js";

const store = createIndexedDbLibraryStore();
const historyStore = createIndexedDbHistoryStore();
const captureStore = createIndexedDbCaptureStore();
const ids = [
  "project", "structure", "content", "asset-mode", "volume-size", "preview", "export", "copy-agent", "pause",
  "nodes", "edges", "conversations", "assets", "volumes", "broken", "reused",
  "duplicate-nodes", "dangling", "missing-evidence", "asset-missing", "canvas-errors",
  "status", "summary", "progress-bar", "progress-text", "quality-verdict", "quality-title", "quality-detail",
];
const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
let currentPlan = null;
let pauseRequested = false;
let exporting = false;
const taskFeedback = createTaskFeedback({ page: "OBSIDIAN EXPORT", autoScroll: true });
const taskAnchor = document.querySelector(".overview-panel");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function setStatus(text, tone = "") { el.status.textContent = text; el.status.className = tone; }
function setProgress(done, total, text) {
  const percent = total ? Math.max(0, Math.min(100, done / total * 100)) : 0;
  el["progress-bar"].style.width = `${percent}%`;
  el["progress-text"].textContent = text || `${done}/${total}`;
  if (taskFeedback.active) taskFeedback.update({ title: text || "正在处理知识库", stage: "处理中", current: done, total, progress: percent, step: 1, anchor: taskAnchor });
}
function waitForDownload(downloadId, timeoutMs = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.downloads.onChanged.removeListener(listener);
      reject(new Error("等待浏览器写入知识库分卷超时。可重新点击导出继续。"));
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
        reject(new Error(`分卷下载被中断：${delta.error?.current || "unknown"}`));
      }
    };
    chrome.downloads.onChanged.addListener(listener);
    chrome.downloads.search({ id: downloadId }, (items) => {
      if (items?.[0]?.state === "complete") {
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(listener);
        resolve();
      }
    });
  });
}
async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const id = await chrome.downloads.download({ url, filename, saveAs: false });
    await waitForDownload(id);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadProjects() {
  const projects = await store.listStateProjects();
  el.project.innerHTML = '<option value="">请选择 Project</option>' + projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.title)}</option>`).join("");
  if (projects.length === 1) el.project.value = projects[0].id;
  el.preview.disabled = !projects.length;
  if (!projects.length) {
    el.summary.classList.add("empty");
    el.summary.innerHTML = '<strong>还没有可导出的 Project</strong><span>先在记录中心创建带 Project 的笔记，或从会话篮子导入 ChatGPT Project。</span><div class="empty-actions"><a class="button-link" href="capture.html">去记录中心新建</a><a class="button-link ghost" href="basket.html">从会话篮子导入</a></div>';
    setStatus("尚无 Project。建立工作范围后才能生成图谱。", "warning");
  } else if (el.project.value) {
    setStatus("已自动选择唯一 Project，可以分析导出。", "success");
  }
  return projects;
}

function renderPlan(plan) {
  const gv = plan.graphValidation.metrics;
  const vr = plan.vault.report;
  const assetStats = plan.assetStats || { materialized: 0, missing: 0, uniqueBytes: 0 };
  el.nodes.textContent = String(gv.nodes);
  el.edges.textContent = String(gv.edges);
  el.conversations.textContent = String(gv.conversationCount);
  el.assets.textContent = String(assetStats.materialized || 0);
  el.volumes.textContent = String(plan.volumeCount);
  el.broken.textContent = String(vr.brokenLinks.length);
  el.reused.textContent = String(vr.reusedPaths);
  el["duplicate-nodes"].textContent = String(gv.duplicateNodeIds);
  el.dangling.textContent = String(gv.danglingEdges);
  el["missing-evidence"].textContent = String(gv.missingEvidenceReferences);
  el["asset-missing"].textContent = String(assetStats.missing || 0);
  el["canvas-errors"].textContent = String(vr.invalidCanvasReferences.length);
  const quality = summarizeKnowledgeQuality(plan);
  el["quality-verdict"].dataset.tone = quality.tone;
  el["quality-title"].textContent = quality.title;
  el["quality-detail"].textContent = quality.detail;
  const sizes = plan.volumes.map((volume) => `${volume.number}. 约 ${(volume.estimatedBytes / 1024 / 1024).toFixed(1)} MB · ${volume.conversationKeys.length} 条会话 · ${(volume.assetNodeIds || []).length} 个附件`);
  const assetLine = plan.assetMode === "include"
    ? `本地附件：纳入 ${assetStats.materialized || 0} 个，缺失或未下载 ${assetStats.missing || 0} 个，唯一体积约 ${(Number(assetStats.uniqueBytes || 0) / 1024 / 1024).toFixed(1)} MB`
    : "本次未导出附件二进制。";
  el.summary.classList.remove("empty");
  el.summary.innerHTML = `<h3>${escapeHtml(plan.projectTitle)}</h3><p>Graph Hash：<code>${escapeHtml(plan.graphHash)}</code></p><ul><li>稳定管理路径：${Object.keys(plan.vault.pathMap).length}</li><li>Canvas：${plan.vault.report.canvasNodes} 个节点 / ${plan.vault.report.canvasEdges} 条连线</li><li>路径复用：${plan.vault.report.reusedPaths}，新增路径：${plan.vault.report.allocatedPaths}</li><li>移除但不自动删除：${plan.vault.report.removedPaths.length}</li><li>${escapeHtml(assetLine)}</li></ul><h3>分卷计划</h3><ul>${sizes.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;
  el.export.disabled = false;
  el["copy-agent"].disabled = false;
}

async function buildPreview() {
  const projectId = el.project.value;
  if (!projectId) throw new Error("请选择 Project");
  taskFeedback.start({ id: "knowledge-preview", title: "正在分析 Obsidian 导出", detail: "逐条测量会话、关系、路径与附件元数据，先生成安全分卷计划。", stage: "建立图谱索引", step: 0, stepLabels: ["索引", "测量", "核验", "可导出"], button: el.preview, buttonLabel: "正在分析…", anchor: taskAnchor, indeterminate: true });
  setStatus("正在逐条读取会话并测量输出大小；已下载附件只读取元数据，不会在预览阶段载入二进制。", "warning");
  el.preview.disabled = true;
  el.export.disabled = true;
  setProgress(0, 1, "正在建立轻量图谱索引……");
  currentPlan = await createKnowledgeExportPlan({
    store,
    historyStore,
    captureStore,
    historyJobId: DEFAULT_HISTORY_JOB_ID,
    projectId,
    structureMode: el.structure.value,
    contentMode: el.content.value,
    assetMode: el["asset-mode"].value,
    maxVolumeBytes: Number(el["volume-size"].value),
    onProgress: (event) => setProgress(event.index, event.total, `测量 ${event.index}/${event.total}：${event.title || ""}`),
  });
  renderPlan(currentPlan);
  setProgress(1, 1, "预览完成");
  const quality = summarizeKnowledgeQuality(currentPlan);
  setStatus(`${quality.title}。${quality.detail}`, quality.tone === "good" ? "success" : quality.tone);
  taskFeedback.success({ title: "导出分析完成", detail: `${currentPlan.volumeCount} 个分卷 · ${currentPlan.graphValidation.metrics.nodes} 个节点；现在可以开始导出。`, button: el.preview });
  el.preview.disabled = false;
}


function buildAgentPrompt(plan) {
  const project = plan?.projectTitle || "未命名项目";
  return `你现在负责安全接管一个 KV Archive Obsidian 导入包。

压缩包或全部分卷路径：<把下载后的本地路径填写在这里>
项目：${project}
推荐导入子目录：KV Archive/${project}

先不要修改任何现有文件。请先完成只读预检：
1. 检查所有 ZIP 分卷是否齐全，并解压到临时目录；
2. 读取 99 System/kv-import-manifest.json、export-report.json 和 path-map.json；
3. 检测 Obsidian、官方 CLI（如有）和候选 Vault；
4. 统计 Markdown、Canvas、附件与总大小；
5. 检查坏 Wiki Links、无效 Canvas 引用、路径冲突与同名文件；
6. 只询问我：A 新建独立 Vault，B 导入已有 Vault，C 只看报告。

得到我确认后再写入。不得覆盖 .obsidian、已有笔记或附件；不得静默安装软件、启用 CLI、修改 PATH、提权或删除文件。写入后必须验证入口笔记、Wiki Links、Canvas 与附件，并按模板生成可回滚的导入收据。`;
}

async function copyAgentPrompt() {
  if (!currentPlan) await buildPreview();
  const prompt = buildAgentPrompt(currentPlan);
  try {
    await navigator.clipboard.writeText(prompt);
  } catch {
    const area = document.createElement("textarea");
    area.value = prompt;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  setStatus("Agent 交接指令已复制。下载 ZIP 后，把本地文件路径补进指令即可。", "success");
}

async function exportVault() {
  if (exporting) return;
  if (!currentPlan) await buildPreview();
  exporting = true;
  pauseRequested = false;
  taskFeedback.start({ id: "knowledge-export", title: "正在导出 Obsidian 知识库", detail: "按分卷生成、写入下载并释放内存；可在当前分卷完成后暂停。", stage: "恢复导出检查点", step: 0, stepLabels: ["恢复", "生成分卷", "写入下载", "完成"], current: 0, total: Math.max(1, currentPlan.volumeCount), button: el.export, buttonLabel: "正在导出…", anchor: taskAnchor });
  el.export.disabled = true;
  el.pause.disabled = false;
  el.preview.disabled = true;
  try {
    const previous = await store.getLatestKnowledgeExportRun(currentPlan.projectId);
    const run = resumableKnowledgeRun(currentPlan, previous);
    run.status = "building";
    run.updatedAt = new Date().toISOString();
    await store.saveKnowledgeExportRun(run);
    const completed = new Set(run.completedVolumes || []);
    for (let number = 1; number <= currentPlan.volumeCount; number += 1) {
      if (completed.has(number)) continue;
      setStatus(`正在生成第 ${number}/${currentPlan.volumeCount} 个分卷。内存中只保留当前分卷。`);
      const volume = await buildKnowledgeExportVolume({
        plan: currentPlan,
        volumeNumber: number,
        store,
        historyStore,
        onProgress: (event) => {
          const label = event.phase === "asset" ? "附件" : "会话";
          setProgress(event.index, event.total, `分卷 ${number}/${currentPlan.volumeCount} · ${label} ${event.index}/${event.total}：${event.title || ""}`);
        },
      });
      setStatus(`第 ${number}/${currentPlan.volumeCount} 卷已生成，等待浏览器写盘……`);
      await downloadBlob(volume.blob, volume.filename);
      completed.add(number);
      run.completedVolumes = [...completed].sort((a, b) => a - b);
      run.updatedAt = new Date().toISOString();
      run.status = pauseRequested ? "paused" : "building";
      await store.saveKnowledgeExportRun(run);
      setProgress(completed.size, currentPlan.volumeCount, `已写盘并释放 ${completed.size}/${currentPlan.volumeCount} 卷`);
      if (pauseRequested) {
        setStatus(`已在当前卷后暂停。完成 ${completed.size}/${currentPlan.volumeCount}，再次点击导出可继续。`, "warning");
        taskFeedback.pause({ title: "知识库导出已暂停", detail: `已完成 ${completed.size}/${currentPlan.volumeCount} 个分卷；再次点击导出会从检查点继续。`, button: el.export });
        return;
      }
    }
    run.status = "completed";
    run.updatedAt = new Date().toISOString();
    await store.saveKnowledgeExportRun(run);
    await store.saveKnowledgeExportProfile(currentPlan.projectId, {
      format: "context-vault-knowledge-export-profile",
      schemaVersion: 1,
      graphHash: currentPlan.graphHash,
      planId: currentPlan.id,
      lastExportedAt: run.updatedAt,
      structureMode: currentPlan.structureMode,
      contentMode: currentPlan.contentMode,
      assetMode: currentPlan.assetMode,
      assetCount: currentPlan.assetStats?.materialized || 0,
      missingAssetCount: currentPlan.assetStats?.missing || 0,
      totalVolumes: currentPlan.volumeCount,
    }, currentPlan.vault.pathMap);
    setStatus(currentPlan.volumeCount === 1 ? "Obsidian Vault 已完成下载。ZIP 内含 START_HERE 和 Agent 交接指令。" : "全部分卷已完成。所有 ZIP 必须解压到同一目录；也可以复制 Agent 交接指令让本地 Agent 安全导入。", "success");
    taskFeedback.success({ title: "Obsidian 知识库导出完成", detail: `${currentPlan.volumeCount} 个分卷已写入 Chrome 下载；下一步可解压或交给本地 Agent 导入。`, button: el.export });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, "error");
    taskFeedback.fail({ title: "知识库导出未完成", detail: `${message}。已完成分卷和检查点仍然保留。`, button: el.export });
    const previous = await store.getLatestKnowledgeExportRun(currentPlan?.projectId || "").catch(() => null);
    if (previous) {
      previous.status = "paused";
      previous.lastError = error instanceof Error ? error.message : String(error);
      previous.updatedAt = new Date().toISOString();
      await store.saveKnowledgeExportRun(previous).catch(() => {});
    }
  } finally {
    exporting = false;
    el.pause.disabled = true;
    el.preview.disabled = false;
    el.export.disabled = !currentPlan;
  }
}

el.preview.addEventListener("click", async () => {
  try { await buildPreview(); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); setStatus(message, "error"); taskFeedback.fail({ title: "导出分析失败", detail: message, button: el.preview }); el.preview.disabled = false; }
});
el.export.addEventListener("click", exportVault);
el["copy-agent"].addEventListener("click", copyAgentPrompt);
el.pause.addEventListener("click", () => { pauseRequested = true; el.pause.disabled = true; taskFeedback.update({ title: "正在安全暂停知识库导出", detail: "当前分卷写盘完成后停止；已有文件和检查点不会丢失。", stage: "等待当前分卷完成", step: 2, indeterminate: true }); setStatus("将在当前分卷写盘完成后暂停。", "warning"); });
for (const control of [el.project, el.structure, el.content, el["asset-mode"], el["volume-size"]]) {
  control.addEventListener("change", () => {
    currentPlan = null;
    el.export.disabled = true;
    el["copy-agent"].disabled = true;
    el.summary.classList.add("empty");
    el.summary.textContent = el.project.value ? "配置已变化，请重新分析。" : "请选择 Project 后再分析。";
    el.preview.disabled = !el.project.value;
    el["quality-verdict"].dataset.tone = "idle";
    el["quality-title"].textContent = "需要重新分析";
    el["quality-detail"].textContent = "导出设置已经变化，重新分析后再判断是否可以安全导出。";
  });
}
await loadProjects();
