const asNumber = (value) => Math.max(0, Number(value ?? 0) || 0);
const isComplete = (job) => job?.status === "completed" || job?.status === "completed_with_errors";

export function derivePopupGuidance({ isConversationPage = false, libraryStats = {}, historyJob = null } = {}) {
  const libraryCount = asNumber(libraryStats.conversations);
  const savedCount = asNumber(historyJob?.stats?.completed ?? historyJob?.completedIds?.length);
  const archive = historyJob?.archiveExport ?? {};
  const totalVolumes = asNumber(archive.totalVolumes);
  const completedVolumes = Array.isArray(archive.completedVolumes) ? archive.completedVolumes.length : 0;

  if (!isConversationPage) {
    return {
      state: "needs-chat",
      title: "先打开一条 ChatGPT 对话",
      body: "打开需要保存的具体对话后，再点击 KV Archive。",
      action: "open-chatgpt",
      actionLabel: "打开 ChatGPT",
    };
  }
  if (historyJob && !isComplete(historyJob)) {
    return {
      state: "resume-backup",
      title: "上次备份还没有完成",
      body: `已经安全保存 ${savedCount} 条对话，可以从检查点继续。`,
      action: "open-backup",
      actionLabel: "继续备份",
    };
  }
  if (isComplete(historyJob) && totalVolumes > completedVolumes) {
    return {
      state: "finish-computer-backup",
      title: "浏览器中已有备份，电脑文件尚未完整生成",
      body: `已保存 ${savedCount} 条对话；还有 ${Math.max(0, totalVolumes - completedVolumes)} 个分卷待生成。`,
      action: "open-backup",
      actionLabel: "生成电脑备份",
    };
  }
  if (isComplete(historyJob) && libraryCount === 0 && savedCount > 0) {
    return {
      state: "index-library",
      title: "备份已经完成，下一步让它可搜索",
      body: `已有 ${savedCount} 条对话保存在浏览器中，加入资料库后即可全文搜索。`,
      action: "open-backup",
      actionLabel: "加入资料库",
    };
  }
  if (libraryCount > 0) {
    return {
      state: "search-library",
      title: `本地资料库已有 ${libraryCount} 条对话`,
      body: "可以继续保存当前对话，也可以直接搜索以前的内容。",
      action: "open-library",
      actionLabel: "搜索资料库",
    };
  }
  return {
    state: "save-current",
    title: "先保存当前这条对话",
    body: "默认收进本地资料库；需要时再同时下载 HTML 或 Markdown。",
    action: "focus-save",
    actionLabel: "开始保存",
  };
}

export function deriveBackupHealth(job, storage = {}) {
  const usage = asNumber(storage.usage);
  const quota = asNumber(storage.quota);
  const stats = job?.stats ?? {};
  const saved = asNumber(stats.completed ?? job?.completedIds?.length);
  const failures = asNumber(stats.failed ?? job?.failures?.length);
  const assetFailures = asNumber(stats.assetFailures) + asNumber(stats.unsupportedAssets);
  const archive = job?.archiveExport ?? {};
  const totalVolumes = asNumber(archive.totalVolumes);
  const completedVolumes = Array.isArray(archive.completedVolumes) ? archive.completedVolumes.length : 0;
  const browserState = saved > 0 ? `已保存 ${saved} 条` : "尚未保存";
  const computerState = archive.status === "completed"
    ? `已生成 ${completedVolumes} 个分卷`
    : completedVolumes > 0
      ? `已生成 ${completedVolumes}/${totalVolumes || "?"} 个分卷`
      : "尚未生成";
  const ratio = quota > 0 ? usage / quota : 0;
  const storageState = quota > 0 ? `${formatBytes(usage)} / ${formatBytes(quota)}` : "浏览器未提供估算";

  if (!job) {
    return {
      tone: "idle",
      title: "尚未建立完整备份",
      browserState,
      computerState,
      storageState,
      persisted: Boolean(storage.persisted),
      nextAction: "开始备份",
      detail: "先完成一次小范围或全量采集，再生成可独立恢复的电脑文件。",
    };
  }
  if (!isComplete(job)) {
    return {
      tone: job.status === "failed" ? "danger" : "warning",
      title: job.status === "failed" ? "备份需要处理" : "备份尚未完成",
      browserState,
      computerState,
      storageState,
      persisted: Boolean(storage.persisted),
      nextAction: "从检查点继续",
      detail: failures ? `${failures} 条对话待重试；已经完成的内容仍保存在浏览器中。` : "已有检查点，可以继续，不需要从头开始。",
    };
  }
  if (archive.status !== "completed") {
    return {
      tone: failures || assetFailures ? "warning" : "good",
      title: "对话已保存在浏览器，电脑备份尚未完成",
      browserState,
      computerState,
      storageState,
      persisted: Boolean(storage.persisted),
      nextAction: "生成电脑备份文件",
      detail: "删除扩展或浏览器数据可能影响本地缓存；建议继续生成 ZIP 分卷。",
    };
  }
  return {
    tone: failures || assetFailures || ratio > 0.85 ? "warning" : "good",
    title: failures || assetFailures ? "备份基本安全，但有待处理项" : "备份状态良好",
    browserState,
    computerState,
    storageState,
    persisted: Boolean(storage.persisted),
    nextAction: failures || assetFailures ? "查看待处理项" : "检查新增内容",
    detail: failures || assetFailures
      ? `对话失败 ${failures}，附件待处理 ${assetFailures}。电脑分卷已生成。`
      : "浏览器本地缓存和电脑备份文件均已建立。",
  };
}

export function buildBackupPreflight({ workspaceLabel = "个人空间", existingJob = null, storage = {}, assetPolicy = "references-only", regularTotal = null, archivedTotal = null, projectCount = null } = {}) {
  const knownConversationTotal = [regularTotal, archivedTotal]
    .filter((value) => Number.isFinite(Number(value)))
    .reduce((sum, value) => sum + Number(value), 0);
  const existingSaved = asNumber(existingJob?.stats?.completed ?? existingJob?.completedIds?.length);
  const estimatedConversations = knownConversationTotal || asNumber(existingJob?.conversations?.length) || existingSaved || null;
  const quota = asNumber(storage.quota);
  const usage = asNumber(storage.usage);
  const free = Math.max(0, quota - usage);
  return {
    workspaceLabel,
    estimatedConversations,
    projectCount: Number.isFinite(Number(projectCount)) ? Number(projectCount) : null,
    assetPolicy,
    assetLabel: assetPolicy === "download" ? "同时下载可访问附件" : "只保存附件引用（推荐）",
    storageLabel: quota ? `约剩余 ${formatBytes(free)}` : "无法从浏览器取得容量估算",
    persisted: Boolean(storage.persisted),
    isResume: Boolean(existingJob && !isComplete(existingJob)),
  };
}

export function classifyRecoveryAction(errorValue) {
  const text = String(errorValue?.message ?? errorValue ?? "");
  if (/未找到 ChatGPT|先打开并登录|具体的 ChatGPT 对话|无法读取 ChatGPT 登录/.test(text)) {
    return { kind: "open-chatgpt", label: "打开 ChatGPT", secondaryLabel: "重新检测" };
  }
  if (/401|403|登录|session|认证|授权/.test(text)) {
    return { kind: "refresh-session", label: "刷新登录页后重试", secondaryLabel: "打开 ChatGPT" };
  }
  if (/工作空间|workspace|account/i.test(text)) {
    return { kind: "choose-workspace", label: "检查工作空间", secondaryLabel: "重新检测" };
  }
  if (/下载|写入|interrupted|浏览器.*中断/.test(text)) {
    return { kind: "show-downloads", label: "查看下载记录", secondaryLabel: "重试" };
  }
  return { kind: "retry", label: "重试", secondaryLabel: "重新检测" };
}

export function summarizeKnowledgeQuality(plan) {
  if (!plan) return { tone: "idle", title: "尚未分析", detail: "选择 Project 后先分析，系统会告诉你是否可以安全导出。" };
  const graph = plan.graphValidation?.metrics ?? {};
  const report = plan.vault?.report ?? {};
  const assets = plan.assetStats ?? {};
  const blockers = asNumber(graph.duplicateNodeIds)
    + asNumber(graph.danglingEdges)
    + asNumber(report.brokenLinks?.length)
    + asNumber(report.invalidCanvasReferences?.length);
  const warnings = asNumber(graph.missingEvidenceReferences) + asNumber(assets.missing);
  if (blockers > 0) {
    return {
      tone: "danger",
      title: "暂不建议导出",
      detail: `发现 ${blockers} 个结构问题。请先查看技术质量报告并修复。`,
    };
  }
  if (warnings > 0) {
    return {
      tone: "warning",
      title: "可以导出，但有少量缺失",
      detail: `结构检查通过；${asNumber(assets.missing)} 个附件未下载，${asNumber(graph.missingEvidenceReferences)} 条证据引用缺失。`,
    };
  }
  return {
    tone: "good",
    title: "可以安全导出",
    detail: `结构检查通过，预计生成 ${asNumber(plan.volumeCount)} 个 ZIP 分卷。`,
  };
}

export function formatBytes(value) {
  const bytes = asNumber(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
