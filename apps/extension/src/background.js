/*
 * ContextVault Debugger Network Adapter MVP.
 * Architecture informed by yesooner/chatgpt-conversation-export-extension
 * commit 9eb0dfe9a6bd9173a53db5ac1cac7caefa8744e2 (MIT).
 */
import { normalizeChatGPTConversation } from "./packages/normalizer/src/index.js";
import { captureVisibleConversationFromTab } from "./generic-dom-adapter.js";
import { detectProviderFromUrl, isStructuredChatGPTConversationUrl } from "./provider-registry.js";
import { getActivePathRenderDiagnostics, renderActivePathMarkdown, renderReadableHtml } from "./packages/renderers/src/index.js";
import { generateIntegrityReport } from "./packages/integrity/src/index.js";
import { buildExportArtifact, resolveExportTitle } from "./export-artifact.js";
import { createIndexedDbLibraryStore } from "./library-store.js";
import { importCandidatesIntoVault } from "./vault-import.js";
import { createChatGPTTransport } from "./history-api.js";
import {
  cancelScheduledBackupTest,
  getScheduledBackupStatus,
  handleScheduledBackupAlarm,
  reconcileScheduledBackupAlarm,
  runScheduledBackupCycle,
  saveScheduledBackupSettings,
  startScheduledBackupTest,
} from "./scheduled-backup.js";

import {
  analyzeConversationCandidate,
  assessStructuredCaptureConfidence,
  chooseBestConversationCandidate,
  conversationIdFromUrl,
  hydrationCorroboratesStructuredCapture,
  decodeResponseBody,
  parseConversationCandidates,
} from "./network-parser.js";

const jobs = new Map();
const libraryStore = createIndexedDbLibraryStore();

async function processResponse(job, requestId) {
  if (!job.requestIds.has(requestId) || job.done) return;
  try {
    const response = await chrome.debugger.sendCommand(job.target, "Network.getResponseBody", { requestId });
    const metadata = job.requestMetadata.get(requestId) ?? {};
    const candidates = parseConversationCandidates(decodeResponseBody(response), {
      expectedId: job.expectedId,
      responseUrl: metadata.url,
    });
    const best = chooseBestConversationCandidate([...(job.best ? [job.best] : []), ...candidates], {
      expectedId: job.expectedId,
    });
    if (!best || (job.best && best.score <= job.best.score)) return;
    job.best = best;
    clearTimeout(job.quietTimer);
    const quietDelay = best.directConversationEndpoint && best.rootReached && best.parentBreaks === 0 ? 500 : 2_500;
    job.quietTimer = setTimeout(() => job.finishBest(), quietDelay);
  } catch {}
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const job = jobs.get(source.tabId);
  if (!job) return;
  if (method === "Network.responseReceived") {
    const response = params.response || {};
    if (/chatgpt\.com|chat\.openai\.com/i.test(response.url || "") && /json|text|event-stream|javascript/i.test(response.mimeType || "")) {
      job.requestIds.add(params.requestId);
      job.requestMetadata.set(params.requestId, { url: response.url || "", mimeType: response.mimeType || "" });
    }
  } else if (method === "Network.loadingFinished") {
    void processResponse(job, params.requestId);
  }
});

async function captureViaDebugger(tabId, sourceUrl) {
  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  try {
    await chrome.debugger.sendCommand(target, "Network.enable", {
      maxTotalBufferSize: 100_000_000,
      maxResourceBufferSize: 50_000_000,
    });
    const result = new Promise((resolve, reject) => {
      const job = {
        target,
        expectedId: conversationIdFromUrl(sourceUrl),
        requestIds: new Set(),
        requestMetadata: new Map(),
        best: null,
        quietTimer: null,
        done: false,
        finishBest() {
          if (job.done || !job.best) return;
          job.done = true;
          clearTimeout(job.timeout);
          clearTimeout(job.quietTimer);
          resolve({
            raw: job.best.conversation,
            completeness: job.best.directConversationEndpoint && job.best.rootReached && job.best.parentBreaks === 0
              ? "verified"
              : "unknown",
            adapter: "chromium-debugger-network-fallback",
            diagnostics: job.best,
          });
        },
      };
      job.timeout = setTimeout(() => {
        if (job.best) job.finishBest();
        else reject(new Error("45 秒内未捕获到可验证的会话响应"));
      }, 45_000);
      jobs.set(tabId, job);
    });
    await chrome.debugger.sendCommand(target, "Page.reload", { ignoreCache: true });
    return await result;
  } finally {
    const job = jobs.get(tabId);
    clearTimeout(job?.timeout);
    clearTimeout(job?.quietTimer);
    jobs.delete(tabId);
    await chrome.debugger.detach(target).catch(() => {});
  }
}

async function captureChatGPTConversation(tabId, sourceUrl) {
  const expectedId = conversationIdFromUrl(sourceUrl);
  if (!expectedId) throw new Error("当前地址缺少 ChatGPT conversation ID。");

  let pageProbe = null;
  let pageProbeError = null;
  try {
    pageProbe = await captureVisibleConversationFromTab(tabId, sourceUrl, {
      provider: "chatgpt",
      adapter: "chatgpt-dom-page-probe",
      completeness: "visible-only",
      hydrateHistory: false,
    });
  } catch (error) {
    pageProbeError = error instanceof Error ? error.message : String(error);
  }
  const pageDiagnostics = pageProbe?.snapshot?.diagnostics ?? {};

  let direct = null;
  let directError = null;
  try {
    const raw = await createChatGPTTransport(tabId).fetchConversation(expectedId);
    const analysis = analyzeConversationCandidate(raw, {
      expectedId,
      responseUrl: `/backend-api/conversation/${expectedId}`,
    });
    if (!analysis.viable || !analysis.exactId) throw new Error("ChatGPT 权威会话接口没有返回匹配当前地址的 Conversation 对象。");
    direct = {
      raw,
      analysis,
      adapter: "chatgpt-authoritative-conversation-api",
    };
  } catch (error) {
    directError = error instanceof Error ? error.message : String(error);
  }

  const hydrate = async () => {
    try {
      return {
        result: await captureVisibleConversationFromTab(tabId, sourceUrl, {
          provider: "chatgpt",
          adapter: "chatgpt-dom-history-hydrator",
          completeness: "partial",
          hydrateHistory: true,
        }),
        error: null,
      };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : String(error) };
    }
  };

  if (direct) {
    const confidence = assessStructuredCaptureConfidence(direct.analysis, pageDiagnostics);
    if (confidence.confident) {
      return {
        raw: direct.raw,
        completeness: "verified",
        adapter: direct.adapter,
        diagnostics: {
          ...direct.analysis,
          confidence,
          pageProbe: pageDiagnostics,
          pageProbeError,
          directApiError: null,
          selectedStructuredSource: "authoritative-api",
        },
        hydratedVisible: null,
      };
    }

    const hydrated = await hydrate();
    const hydrationDiagnostics = hydrated.result?.snapshot?.diagnostics ?? {};
    const accumulatedMessages = hydrated.result?.snapshot?.messages?.length ?? 0;
    const corroborated = hydrationCorroboratesStructuredCapture(
      direct.analysis,
      hydrationDiagnostics,
      accumulatedMessages,
    );
    return {
      raw: direct.raw,
      completeness: corroborated ? "verified" : "unknown",
      adapter: direct.adapter,
      diagnostics: {
        ...direct.analysis,
        confidence,
        pageProbe: pageDiagnostics,
        pageProbeError,
        directApiError: null,
        debuggerError: null,
        hydrationError: hydrated.error,
        hydrationDiagnostics,
        hydrationCorroborated: corroborated,
        selectedStructuredSource: "authoritative-api",
      },
      hydratedVisible: hydrated.result,
    };
  }

  let fallback = null;
  let debuggerError = null;
  try {
    fallback = await captureViaDebugger(tabId, sourceUrl);
  } catch (error) {
    debuggerError = error instanceof Error ? error.message : String(error);
  }

  if (fallback?.raw) {
    const confidence = assessStructuredCaptureConfidence(fallback.diagnostics, pageDiagnostics);
    if (confidence.confident) {
      return {
        ...fallback,
        completeness: "verified",
        diagnostics: {
          ...fallback.diagnostics,
          confidence,
          pageProbe: pageDiagnostics,
          pageProbeError,
          directApiError: directError,
          debuggerError: null,
          selectedStructuredSource: "debugger-network",
        },
        hydratedVisible: null,
      };
    }

    const hydrated = await hydrate();
    const hydrationDiagnostics = hydrated.result?.snapshot?.diagnostics ?? {};
    const accumulatedMessages = hydrated.result?.snapshot?.messages?.length ?? 0;
    const corroborated = hydrationCorroboratesStructuredCapture(
      fallback.diagnostics,
      hydrationDiagnostics,
      accumulatedMessages,
    );
    return {
      ...fallback,
      completeness: corroborated ? "verified" : "unknown",
      diagnostics: {
        ...fallback.diagnostics,
        confidence,
        pageProbe: pageDiagnostics,
        pageProbeError,
        directApiError: directError,
        debuggerError: null,
        hydrationError: hydrated.error,
        hydrationDiagnostics,
        hydrationCorroborated: corroborated,
        selectedStructuredSource: "debugger-network",
      },
      hydratedVisible: hydrated.result,
    };
  }

  const hydrated = await hydrate();
  if (!hydrated.result) {
    throw new Error(`无法读取完整会话。接口：${directError || "未知失败"}；网络：${debuggerError || "未知失败"}；页面回溯：${hydrated.error || "未知失败"}`);
  }
  return {
    raw: null,
    completeness: "unknown",
    adapter: "chatgpt-dom-history-hydrator",
    diagnostics: {
      directApiError: directError,
      debuggerError,
      hydrationError: hydrated.error,
      pageProbe: pageDiagnostics,
      pageProbeError,
      selectedStructuredSource: null,
    },
    hydratedVisible: hydrated.result,
  };
}

function bytesDataUrl(bytes, mimeType) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function download(filename, url) {
  return chrome.downloads.download({ url, filename, saveAs: false });
}

async function setBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
  await chrome.action.setBadgeText({ text }).catch(() => {});
  setTimeout(() => chrome.action.setBadgeText({ text: "" }).catch(() => {}), 8000);
}

async function exportCurrent(tabId, sourceUrl, format = "readable-html", contentMode = "conversation", options = {}) {
  await setBadge("…", "#52545b");
  const provider = detectProviderFromUrl(sourceUrl);
  let raw;
  let canonical;
  let report;
  if (isStructuredChatGPTConversationUrl(sourceUrl)) {
    const captured = await captureChatGPTConversation(tabId, sourceUrl);
    let structuredCanonical = null;
    let structuredReport = null;
    let structuredNormalizationError = null;
    if (captured.raw) {
      try {
        structuredCanonical = normalizeChatGPTConversation(captured.raw, {
          provider: "chatgpt",
          adapter: captured.adapter,
          sourceUrl,
          captureMode: "structured",
          completeness: captured.completeness,
        });
        structuredCanonical.metadata = {
          ...structuredCanonical.metadata,
          captureDiagnostics: {
            nodeCount: captured.diagnostics?.nodeCount ?? null,
            messageNodeCount: captured.diagnostics?.messageNodeCount ?? null,
            activePathMessages: captured.diagnostics?.activePathMessages ?? null,
            userMessages: captured.diagnostics?.userMessages ?? null,
            assistantMessages: captured.diagnostics?.assistantMessages ?? null,
            rootReached: captured.diagnostics?.rootReached ?? false,
            parentBreaks: captured.diagnostics?.parentBreaks ?? null,
            directConversationEndpoint: captured.diagnostics?.directConversationEndpoint ?? false,
            currentNodeId: captured.diagnostics?.currentNodeId ?? null,
            currentMessageId: captured.diagnostics?.currentMessageId ?? null,
            confidenceReasons: captured.completeness === "verified" ? [] : (captured.diagnostics?.confidence?.reasons ?? []),
            initialConfidenceReasons: captured.diagnostics?.confidence?.reasons ?? [],
            pageLowerBound: captured.diagnostics?.confidence?.pageLowerBound ?? null,
            pageProbe: captured.diagnostics?.pageProbe ?? null,
            hydrationOutcome: captured.diagnostics?.hydrationDiagnostics?.hydrationOutcome ?? null,
            hydrationComplete: captured.diagnostics?.hydrationDiagnostics?.hydrationComplete ?? null,
            hydrationIterations: captured.diagnostics?.hydrationDiagnostics?.iterations ?? null,
            hydrationCorroborated: captured.diagnostics?.hydrationCorroborated ?? false,
            selectedStructuredSource: captured.diagnostics?.selectedStructuredSource ?? null,
            directApiError: captured.diagnostics?.directApiError ?? null,
            debuggerError: captured.diagnostics?.debuggerError ?? null,
            hydrationError: captured.diagnostics?.hydrationError ?? null,
          },
        };
        structuredReport = generateIntegrityReport(structuredCanonical);
      } catch (error) {
        structuredNormalizationError = error instanceof Error ? error.message : String(error);
      }
    }

    const visibleCanonical = captured.hydratedVisible?.canonical ?? null;
    const visibleReport = visibleCanonical ? generateIntegrityReport(visibleCanonical) : null;
    const structuredCount = structuredReport?.renderableConversationMessages ?? 0;
    const visibleCount = visibleReport?.renderableConversationMessages ?? 0;
    const useHydratedVisible = Boolean(visibleCanonical && (!structuredCanonical || visibleCount > structuredCount));

    if (useHydratedVisible) {
      raw = captured.hydratedVisible.snapshot;
      canonical = visibleCanonical;
      const hydrationDiagnostics = captured.hydratedVisible.snapshot?.diagnostics ?? {};
      canonical.metadata = {
        ...canonical.metadata,
        captureDiagnostics: {
          ...(canonical.metadata.captureDiagnostics ?? {}),
          structuredCandidateMessages: structuredCount,
          selectedCapture: "hydrated-dom",
          selectionReason: structuredCanonical ? "more-readable-messages" : "structured-unavailable",
          structuredNormalizationError,
          confidenceReasons: captured.diagnostics?.confidence?.reasons ?? [],
          pageLowerBound: captured.diagnostics?.confidence?.pageLowerBound ?? null,
          directApiError: captured.diagnostics?.directApiError ?? null,
          debuggerError: captured.diagnostics?.debuggerError ?? null,
        },
      };
      const hydrationIssues = [];
      if (!hydrationDiagnostics.hydrationComplete) {
        hydrationIssues.push({
          code: "HYDRATION_INCOMPLETE",
          severity: "warning",
          nodeId: null,
          message: `DOM history hydration stopped with outcome ${hydrationDiagnostics.hydrationOutcome || "unknown"}; older messages may still be missing.`,
        });
      }
      report = {
        ...visibleReport,
        status: visibleReport.status === "FAILED" ? "FAILED" : "PARTIAL",
        issues: [...visibleReport.issues, ...hydrationIssues, {
          code: "HYDRATED_DOM_SELECTED",
          severity: "warning",
          nodeId: null,
          message: `Structured capture exposed ${structuredCount} readable message(s), while upward DOM hydration accumulated ${visibleCount}; the larger DOM branch was exported without claiming verified completeness.`,
        }],
      };
    } else if (structuredCanonical && structuredReport) {
      raw = captured.raw;
      canonical = structuredCanonical;
      report = structuredReport;
      const confidenceReasons = captured.diagnostics?.confidence?.reasons ?? [];
      if (confidenceReasons.length > 0 && report.status !== "COMPLETE") {
        report = {
          ...report,
          issues: [...report.issues, {
            code: "STRUCTURED_CAPTURE_REQUIRES_CORROBORATION",
            severity: "warning",
            nodeId: null,
            message: `Structured capture confidence warnings: ${confidenceReasons.join(", ")}.`,
          }],
        };
      }
    } else {
      throw new Error(`结构化会话无法归一化，且页面回溯没有可用结果${structuredNormalizationError ? `：${structuredNormalizationError}` : ""}`);
    }
  } else {
    const visible = await captureVisibleConversationFromTab(tabId, sourceUrl, {
      provider: provider.id,
      adapter: `${provider.id}-dom-history-hydrator`,
      completeness: "visible-only",
      hydrateHistory: true,
    });
    raw = visible.snapshot;
    canonical = visible.canonical;
    const baseReport = generateIntegrityReport(canonical);
    report = {
      ...baseReport,
      status: baseReport.status === "FAILED" ? "FAILED" : "PARTIAL",
      issues: [...baseReport.issues, {
        code: "VISIBLE_ONLY_CAPTURE",
        severity: "warning",
        nodeId: null,
        message: "Only messages visible in the current page DOM were captured; hidden history, branches and original attachments may be missing.",
      }],
    };
  }
  const safeContentMode = ["conversation", "assistant-only", "technical"].includes(contentMode) ? contentMode : "conversation";
  const renderDiagnostics = getActivePathRenderDiagnostics(canonical, { mode: safeContentMode });
  const captureDiagnostics = canonical.metadata?.captureDiagnostics ?? {};
  const pipelineCounts = {
    rawSourceNodes: captureDiagnostics.nodeCount ?? captureDiagnostics.accumulatedMessages ?? report.totalNodes ?? null,
    parentTraceNodes: captureDiagnostics.activePathMessages ?? captureDiagnostics.accumulatedMessages ?? report.activePathMessages ?? null,
    normalizedMessages: canonical.activePath.length,
    exportedMessages: renderDiagnostics.renderedMessages,
    captureAdapter: canonical.source.adapter ?? null,
    sourceCompleteness: canonical.source.completeness ?? "unknown",
    selectedCapture: captureDiagnostics.selectedCapture ?? captureDiagnostics.selectedStructuredSource ?? null,
    hydrationOutcome: captureDiagnostics.hydrationOutcome ?? null,
    hydrationComplete: captureDiagnostics.hydrationComplete ?? null,
    hydrationIterations: captureDiagnostics.hydrationIterations ?? captureDiagnostics.iterations ?? null,
    pageLowerBound: captureDiagnostics.pageLowerBound ?? captureDiagnostics.maxStableTurnOrdinal ?? null,
    userVoiceTranscriptMessages: report.userVoiceTranscriptMessages ?? null,
    assistantVoiceTranscriptMessages: report.assistantVoiceTranscriptMessages ?? null,
    confidenceReasons: Array.isArray(captureDiagnostics.confidenceReasons) ? captureDiagnostics.confidenceReasons : [],
  };
  canonical.metadata = {
    ...canonical.metadata,
    captureDiagnostics: { ...captureDiagnostics, pipelineCounts },
  };
  report = { ...report, pipelineCounts };
  const shouldDownload = options.downloadFile !== false;
  const shouldSaveToLibrary = Boolean(options.saveToLibrary);
  if (!shouldDownload && !shouldSaveToLibrary) throw new Error("请至少选择保存到资料库或下载一个文件。");

  let libraryReport = null;
  if (shouldSaveToLibrary) {
    libraryReport = await importCandidatesIntoVault({
      candidates: [{
        canonical,
        rawEvidence: raw,
        sourceMetadata: {
          capturedAt: new Date().toISOString(),
          sourceUrl,
          captureDiagnostics: canonical.metadata.captureDiagnostics ?? null,
        },
        source: {
          kind: "kv-archive-current-conversation",
          fileName: `KV Archive 当前 AI 对话 · ${provider.displayName}`,
          fingerprint: `current:${canonical.source.provider}:${canonical.conversationId}:${canonical.updatedAt || canonical.createdAt || "unknown"}`,
        },
      }],
      store: libraryStore,
      importMetadata: {
        files: 0,
        detected: { contextVault: 1, official: 0 },
        fileNames: [`KV Archive 当前 AI 对话 · ${provider.displayName}`],
        fingerprints: [`current:${canonical.source.provider}:${canonical.conversationId}:${canonical.updatedAt || canonical.createdAt || "unknown"}`],
      },
    });
  }

  let artifact = null;
  let downloadId = null;
  let exportTitle = null;
  if (shouldDownload) {
    const markdown = renderActivePathMarkdown(canonical, { mode: safeContentMode });
    const html = renderReadableHtml(canonical, { integrityStatus: report.status, mode: safeContentMode, diagnostics: pipelineCounts });
    const technicalMarkdown = safeContentMode === "technical" ? markdown : renderActivePathMarkdown(canonical, { mode: "technical" });
    const technicalDiagnostics = getActivePathRenderDiagnostics(canonical, { mode: "technical" });
    const technicalPipelineCounts = { ...pipelineCounts, exportedMessages: technicalDiagnostics.renderedMessages };
    const technicalHtml = safeContentMode === "technical" ? html : renderReadableHtml(canonical, { integrityStatus: report.status, mode: "technical", diagnostics: technicalPipelineCounts });
    const currentTab = await chrome.tabs.get(tabId).catch(() => null);
    exportTitle = resolveExportTitle({ canonical, raw, tabTitle: currentTab?.title, providerDisplayName: provider.displayName });
    artifact = buildExportArtifact({
      format,
      title: exportTitle,
      raw,
      canonical,
      report,
      markdown,
      html,
      technicalMarkdown,
      technicalHtml,
      includeTechnicalEvidence: safeContentMode === "technical",
    });
    downloadId = await download(artifact.filename, bytesDataUrl(artifact.bytes, artifact.mimeType));
  }

  await setBadge("OK", report.status === "COMPLETE" ? "#315846" : "#81651e");
  return {
    filename: artifact?.filename ?? null,
    downloadId,
    savedToLibrary: shouldSaveToLibrary,
    libraryReport,
    conversationId: canonical.conversationId,
    title: canonical.title,
    exportTitle,
    messageCount: report.renderableConversationMessages,
    rawActivePathCount: report.activePathMessages,
    filteredTechnicalNodes: report.filteredTechnicalNodes,
    integrityStatus: report.status,
    provider: canonical.source.provider,
    providerDisplayName: provider.displayName,
    captureMode: canonical.source.captureMode ?? "unknown",
    pipelineCounts,
  };
}

chrome.alarms.onAlarm.addListener((alarm) => {
  void handleScheduledBackupAlarm(alarm).catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  void reconcileScheduledBackupAlarm().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  void reconcileScheduledBackupAlarm().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  let operation = null;
  if (message?.type === "context-vault-export-current") {
    operation = exportCurrent(message.tabId, message.url, message.format, message.contentMode, {
      saveToLibrary: message.saveToLibrary,
      downloadFile: message.downloadFile,
    });
  } else if (message?.type === "context-vault-schedule-get") {
    operation = getScheduledBackupStatus();
  } else if (message?.type === "context-vault-schedule-save") {
    operation = saveScheduledBackupSettings(message.settings ?? {});
  } else if (message?.type === "context-vault-schedule-run-now") {
    operation = runScheduledBackupCycle({ reason: "manual", sliceMs: 45_000 });
  } else if (message?.type === "context-vault-schedule-test-start") {
    operation = startScheduledBackupTest({ delayMinutes: message.delayMinutes ?? 10 });
  } else if (message?.type === "context-vault-schedule-test-cancel") {
    operation = cancelScheduledBackupTest();
  } else if (message?.type === "context-vault-schedule-reconcile") {
    operation = reconcileScheduledBackupAlarm();
  } else {
    return false;
  }

  Promise.resolve(operation)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch(async (error) => {
      await setBadge("!", "#7d3030");
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});

void reconcileScheduledBackupAlarm().catch(() => {});
