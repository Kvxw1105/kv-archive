import { createIndexedDbHistoryStore } from "./history-store.js";
import { createIndexedDbLibraryStore } from "./library-store.js";
import { DEFAULT_HISTORY_JOB_ID } from "./history-engine.js";
import { classifyRecoveryAction, derivePopupGuidance } from "./ux-guidance.js";
import { detectProviderFromUrl, isLikelyConversationUrl, isStructuredChatGPTConversationUrl } from "./provider-registry.js";
import { openWorkspacePage } from "./workspace-navigation.js";
import { createTaskFeedback } from "./task-feedback.js";

const historyStore = createIndexedDbHistoryStore();
const libraryStore = createIndexedDbLibraryStore();
const byId = (id) => document.getElementById(id);
const elements = Object.fromEntries([
  "knowledge", "memory", "state", "library", "capture", "history", "basket", "export", "status", "format", "format-help",
  "content-mode", "save-library", "download-file", "download-options", "result-actions", "open-library",
  "show-download", "generic-capture", "next-step", "next-step-title", "next-step-body", "next-step-action", "hero-title",
  "hero-description", "recovery-actions", "recovery-primary", "recovery-secondary",
].map((id) => [id, byId(id)]));

let activeTab = null;
let lastDownloadId = null;
let lastRecovery = null;
let currentGuidance = null;
let forceGenericCapture = false;

const taskFeedback = createTaskFeedback({
  page: "CURRENT CONVERSATION",
  compact: true,
  mount: document.querySelector(".popup-shell"),
  before: document.querySelector(".export-card"),
  autoScroll: false,
});

const formatCopy = {
  "readable-html": { help: "适合日常阅读与分享。" },
  markdown: { help: "适合放进 Obsidian、Notion 或代码仓库。" },
  "backup-zip": { help: "精简 ZIP 默认不含原始技术证据；选择完整技术记录后才会加入。" },
};
const contentCopy = {
  conversation: "默认不导出工具调用、工具结果和推理摘要。",
  "assistant-only": "只保留 AI 正式回答，适合交给本地 Agent 读取。",
  technical: "包含工具调用、工具结果和可见推理摘要；在 HTML 中默认折叠。",
};

function pageCaptureInfo(url) {
  const provider = detectProviderFromUrl(url);
  const isStructuredChatGPT = isStructuredChatGPTConversationUrl(url);
  const likelyConversation = isLikelyConversationUrl(url);
  const supported = isStructuredChatGPT || likelyConversation || forceGenericCapture;
  return { provider, supported, isStructuredChatGPT, forcedGeneric: forceGenericCapture && !likelyConversation, captureMode: isStructuredChatGPT ? "structured" : supported ? "visible-only" : "unsupported" };
}

function isConversationUrl(url) {
  return pageCaptureInfo(url).supported;
}

function setStatus(text, tone = "") {
  elements.status.textContent = text;
  elements.status.dataset.tone = tone;
}

function setRecovery(error) {
  lastRecovery = classifyRecoveryAction(error);
  elements["recovery-primary"].textContent = lastRecovery.label;
  elements["recovery-secondary"].textContent = lastRecovery.secondaryLabel;
  elements["recovery-actions"].hidden = false;
}

function clearRecovery() {
  lastRecovery = null;
  elements["recovery-actions"].hidden = true;
}

function syncDownloadOptions() {
  const enabled = elements["download-file"].checked;
  elements["download-options"].classList.toggle("is-disabled", !enabled);
  elements.format.disabled = !enabled;
  elements["content-mode"].disabled = !enabled;
  if (enabled) elements["download-options"].open = true;
  const selected = formatCopy[elements.format.value] || formatCopy["readable-html"];
  const selectedContent = contentCopy[elements["content-mode"].value] || contentCopy.conversation;
  elements["format-help"].textContent = `${selected.help} ${selectedContent}`;
  elements.export.textContent = enabled ? "保存并下载" : "保存当前对话";
}

async function openExtensionPage(file) {
  await openWorkspacePage(chrome, file);
  window.close();
}

async function applyGuidanceAction(action) {
  if (action === "open-chatgpt") {
    await chrome.tabs.create({ url: "https://chatgpt.com/" });
    window.close();
  } else if (action === "open-backup") {
    await openExtensionPage("backup.html");
  } else if (action === "open-library") {
    await openExtensionPage("library.html");
  } else if (action === "focus-save") {
    elements.export.focus();
  }
}

async function loadGuidance({ preserveStatus = false } = {}) {
  try {
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [libraryStats, historyJob] = await Promise.all([
      libraryStore.getStats().catch(() => ({})),
      historyStore.getLatestJob(DEFAULT_HISTORY_JOB_ID).catch(() => null),
    ]);
    currentGuidance = derivePopupGuidance({
      isConversationPage: isConversationUrl(activeTab?.url),
      libraryStats,
      historyJob,
    });
    elements["next-step"].dataset.state = currentGuidance.state;
    elements["next-step-title"].textContent = currentGuidance.title;
    elements["next-step-body"].textContent = currentGuidance.body;
    elements["next-step-action"].textContent = currentGuidance.actionLabel;
    elements["next-step-action"].disabled = false;
    const capture = pageCaptureInfo(activeTab?.url);
    if (!capture.supported) {
      elements["hero-title"].textContent = "先打开一条 AI 对话";
      elements["hero-description"].textContent = "未识别为已适配的会话页面。仍可由你主动尝试通用模式，只保存页面中可见的消息。";
      elements.export.disabled = true;
      elements["generic-capture"].hidden = false;
      if (!preserveStatus) setStatus("当前页面未被识别为已适配对话；可尝试通用可见内容模式。", "warning");
    } else {
      elements["generic-capture"].hidden = true;
      elements["hero-title"].textContent = `保存这段 ${capture.provider.displayName} 对话`;
      elements["hero-description"].textContent = capture.captureMode === "structured"
        ? "当前平台支持结构化高保真采集，可保存分支、消息和可识别附件。"
        : "当前平台先使用可见内容模式：保存页面中已经显示的消息，不冒充完整历史备份。";
      elements.export.disabled = false;
      if (!preserveStatus) setStatus(capture.captureMode === "structured" ? "当前对话可以高保真保存。" : "当前页面可以按可见内容保存。", capture.captureMode === "structured" ? "" : "warning");
    }
  } catch (error) {
    setStatus(`状态检查失败：${error instanceof Error ? error.message : String(error)}`, "error");
    setRecovery(error);
  }
}

elements.format.addEventListener("change", syncDownloadOptions);
elements["content-mode"].addEventListener("change", syncDownloadOptions);
elements["download-file"].addEventListener("change", syncDownloadOptions);
elements["save-library"].addEventListener("change", () => {
  if (!elements["save-library"].checked && !elements["download-file"].checked) elements["download-file"].checked = true;
  syncDownloadOptions();
});
elements["next-step-action"].addEventListener("click", () => applyGuidanceAction(currentGuidance?.action));
elements["generic-capture"].addEventListener("click", async () => {
  forceGenericCapture = true;
  elements["generic-capture"].hidden = true;
  await loadGuidance();
  elements.export.focus();
});

elements.export.addEventListener("click", async () => {
  elements.export.disabled = true;
  elements["result-actions"].hidden = true;
  clearRecovery();
  const captureBefore = pageCaptureInfo(activeTab?.url);
  const statusText = captureBefore.captureMode === "structured" ? "正在读取并核对完整对话。必要时页面会自动向上加载历史，请勿操作或关闭标签页……" : "正在自动向上加载并累积当前页面的对话内容……";
  setStatus(statusText);
  taskFeedback.start({
    title: "正在保存当前对话",
    detail: statusText,
    stage: "连接当前页面",
    step: 0,
    button: elements.export,
    buttonLabel: "正在保存…",
    indeterminate: true,
  });
  try {
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id || !isConversationUrl(activeTab.url)) throw new Error("请先打开一个已识别 AI 平台的对话页面，再点击保存。");
    const saveToLibrary = elements["save-library"].checked;
    const downloadFile = elements["download-file"].checked;
    if (!saveToLibrary && !downloadFile) throw new Error("请至少选择收进资料库或下载文件。");
    const result = await chrome.runtime.sendMessage({
      type: "context-vault-export-current",
      tabId: activeTab.id,
      url: activeTab.url,
      format: elements.format.value,
      contentMode: elements["content-mode"].value,
      saveToLibrary,
      downloadFile,
    });
    if (!result?.ok) throw new Error(result?.error || "保存失败");
    lastDownloadId = result.downloadId ?? null;
    const parts = [];
    if (result.savedToLibrary) parts.push("已收进本地资料库");
    if (result.filename) parts.push(`已下载 ${result.filename}`);
    const completion = `${parts.join("；")}。`;
    setStatus(completion, "success");
    taskFeedback.success({
      title: "当前对话已保存",
      detail: completion,
      stage: "结果已生成",
      button: elements.export,
    });
    elements["result-actions"].hidden = false;
    elements["open-library"].hidden = !result.savedToLibrary;
    elements["show-download"].hidden = !lastDownloadId;
    await loadGuidance({ preserveStatus: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`保存失败：${message}`, "error");
    taskFeedback.fail({ title: "保存未完成", detail: message, button: elements.export });
    setRecovery(error);
  } finally {
    elements.export.disabled = !isConversationUrl(activeTab?.url);
  }
});

elements["open-library"].addEventListener("click", () => openExtensionPage("library.html"));
elements["show-download"].addEventListener("click", async () => {
  if (!lastDownloadId) return;
  try { chrome.downloads.show(lastDownloadId); }
  catch { chrome.downloads.showDefaultFolder(); }
});

elements["recovery-primary"].addEventListener("click", async () => {
  if (!lastRecovery) return;
  if (["open-chatgpt", "refresh-session", "choose-workspace"].includes(lastRecovery.kind)) {
    await chrome.tabs.create({ url: "https://chatgpt.com/" });
    window.close();
  } else if (lastRecovery.kind === "show-downloads") {
    chrome.downloads.showDefaultFolder();
  } else {
    await loadGuidance();
  }
});
elements["recovery-secondary"].addEventListener("click", async () => {
  if (lastRecovery?.kind === "show-downloads") elements.export.click();
  else await loadGuidance();
});

elements.history.addEventListener("click", () => openExtensionPage("backup.html"));
elements.basket.addEventListener("click", () => openExtensionPage("basket.html"));
elements.library.addEventListener("click", () => openExtensionPage("library.html"));
elements.capture.addEventListener("click", () => openExtensionPage("capture.html"));
elements.state.addEventListener("click", () => openExtensionPage("state.html"));
elements.memory.addEventListener("click", () => openExtensionPage("memory.html"));
elements.knowledge.addEventListener("click", () => openExtensionPage("knowledge.html"));

syncDownloadOptions();
await loadGuidance();
