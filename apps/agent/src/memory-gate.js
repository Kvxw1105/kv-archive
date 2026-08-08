const POLICY_VALUES = new Set(["safe", "balanced", "broad"]);
const TARGET_VALUES = new Set(["internal", "external"]);

function clean(value, max = 20_000) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => clean(value, 4_000)).filter(Boolean))];
}

function safeDate(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function estimateGateTokens(value) {
  const text = String(value || "");
  const cjk = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
  const other = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, "").length;
  return Math.max(1, Math.ceil(cjk * 1.15 + other / 4));
}

function candidateText(candidate) {
  return [candidate.title, candidate.text].map((value) => clean(value)).filter(Boolean).join("：");
}

function priorityScore(candidate) {
  const kindScore = {
    blocker: 100,
    project_status: 95,
    decision: 90,
    task: 80,
    next_action: 75,
  }[candidate.kind] || 50;
  const taskPriority = { critical: 12, high: 8, medium: 4, low: 0 }[candidate.priority] || 0;
  return (candidate.locked ? 1000 : 0) + kindScore + taskPriority + Math.max(0, Math.min(Number(candidate.importance || 0), 100));
}

function stableCandidateSort(left, right) {
  return priorityScore(right) - priorityScore(left)
    || safeDate(right.updatedAt) - safeDate(left.updatedAt)
    || String(left.id).localeCompare(String(right.id));
}

function normalizeCandidate(candidate, index = 0) {
  const text = candidateText(candidate);
  return {
    id: clean(candidate.id || `memory-${index + 1}`, 300),
    projectId: clean(candidate.projectId, 300),
    projectTitle: clean(candidate.projectTitle, 500),
    kind: clean(candidate.kind || "memory", 100),
    title: clean(candidate.title, 500),
    text: clean(candidate.text),
    status: clean(candidate.status || "active", 100),
    priority: clean(candidate.priority || "medium", 100),
    importance: Math.max(0, Math.min(100, Number(candidate.importance || 0))),
    locked: Boolean(candidate.locked),
    sensitivity: ["public", "internal", "restricted"].includes(candidate.sensitivity) ? candidate.sensitivity : "internal",
    scope: clean(candidate.scope || candidate.projectId, 300),
    evidenceUris: unique(candidate.evidenceUris),
    invalidEvidenceUris: unique(candidate.invalidEvidenceUris),
    conflictsWith: unique(candidate.conflictsWith),
    supersededBy: clean(candidate.supersededBy, 300) || null,
    expiresAt: clean(candidate.expiresAt, 100) || null,
    updatedAt: clean(candidate.updatedAt, 100) || null,
    source: clean(candidate.source || "unknown", 100),
    estimatedTokens: Math.max(1, Number(candidate.estimatedTokens || estimateGateTokens(text))),
  };
}

function approvedStateUri(state, suffix) {
  return `contextvault://project/${encodeURIComponent(state.projectId)}/state/${Number(state.stateVersion || 0)}#${encodeURIComponent(suffix)}`;
}

export function buildProjectMemoryCandidates(state, options = {}) {
  if (!state?.projectId) throw new Error("Approved Project State is required");
  const verifyEvidence = typeof options.verifyEvidence === "function" ? options.verifyEvidence : () => true;
  const common = {
    projectId: state.projectId,
    projectTitle: state.projectTitle || state.projectId,
    scope: state.projectId,
    source: "approved_project_state",
    updatedAt: state.updatedAt || null,
    sensitivity: "internal",
  };
  const candidates = [];
  const status = state.status || {};
  const statusText = [
    status.phase ? `阶段：${status.phase}` : "",
    status.health ? `健康度：${status.health}` : "",
    status.progressPercent !== null && status.progressPercent !== undefined ? `进度：${status.progressPercent}%` : "",
    status.summary || "",
  ].filter(Boolean).join("；");
  if (statusText) candidates.push({
    ...common,
    id: `state:${state.projectId}:status`,
    kind: "project_status",
    title: "已批准项目状态",
    text: statusText,
    locked: true,
    importance: 100,
    evidenceUris: [approvedStateUri(state, "status")],
  });
  for (let index = 0; index < (status.blockers || []).length; index += 1) candidates.push({
    ...common,
    id: `state:${state.projectId}:blocker:${index + 1}`,
    kind: "blocker",
    title: "阻塞事项",
    text: status.blockers[index],
    locked: true,
    importance: 100,
    priority: "critical",
    evidenceUris: [approvedStateUri(state, `blocker-${index + 1}`)],
  });
  for (let index = 0; index < (status.nextActions || []).length; index += 1) candidates.push({
    ...common,
    id: `state:${state.projectId}:next:${index + 1}`,
    kind: "next_action",
    title: "下一步",
    text: status.nextActions[index],
    importance: 80,
    priority: "high",
    evidenceUris: [approvedStateUri(state, `next-${index + 1}`)],
  });
  for (const decision of state.decisions || []) {
    const evidenceUris = unique(decision.evidenceUris);
    candidates.push({
      ...common,
      source: "approved_record",
      id: `decision:${decision.id}`,
      kind: "decision",
      title: decision.title,
      text: decision.summary || (decision.consequences || []).join("；"),
      status: decision.status || "active",
      importance: Number(decision.importance || 90),
      priority: "high",
      locked: Boolean(decision.locked),
      sensitivity: decision.sensitivity || common.sensitivity,
      scope: decision.scope || common.scope,
      expiresAt: decision.expiresAt || null,
      conflictsWith: decision.conflictsWith || [],
      evidenceUris,
      invalidEvidenceUris: evidenceUris.filter((uri) => !verifyEvidence(uri)),
      supersededBy: decision.supersededByProposalId || null,
      updatedAt: decision.updatedAt || decision.createdAt || common.updatedAt,
    });
  }
  for (const task of state.tasks || []) {
    const evidenceUris = unique(task.evidenceUris);
    candidates.push({
      ...common,
      source: "approved_record",
      id: `task:${task.id}`,
      kind: "task",
      title: task.title,
      text: task.notes,
      status: task.status || "todo",
      priority: task.priority || "medium",
      importance: Number(task.importance || (task.priority === "critical" ? 95 : task.priority === "high" ? 85 : 70)),
      locked: Boolean(task.locked),
      sensitivity: task.sensitivity || common.sensitivity,
      scope: task.scope || common.scope,
      expiresAt: task.expiresAt || null,
      conflictsWith: task.conflictsWith || [],
      evidenceUris,
      invalidEvidenceUris: evidenceUris.filter((uri) => !verifyEvidence(uri)),
      supersededBy: task.supersededByProposalId || null,
      updatedAt: task.updatedAt || task.createdAt || common.updatedAt,
    });
  }
  return candidates.map(normalizeCandidate);
}

function baseDecision(candidate) {
  return {
    candidate,
    decision: "INCLUDE",
    reasonCodes: [],
    warnings: [],
    allocatedTokens: 0,
  };
}

function decideCandidate(candidate, options) {
  const result = baseDecision(candidate);
  const now = safeDate(options.generatedAt || new Date().toISOString());
  const inactive = new Set(["superseded", "reversed", "done", "cancelled"]);
  if (candidate.projectId !== options.projectId || (candidate.scope && candidate.scope !== options.projectId)) {
    result.decision = "EXCLUDE";
    result.reasonCodes.push("CROSS_PROJECT_SCOPE");
    return result;
  }
  if (candidate.supersededBy || inactive.has(candidate.status)) {
    result.decision = "EXCLUDE";
    result.reasonCodes.push(candidate.supersededBy || candidate.status === "superseded" ? "SUPERSEDED" : "INACTIVE_RECORD");
    return result;
  }
  if (candidate.expiresAt) {
    const expiry = safeDate(candidate.expiresAt);
    if (!expiry) {
      result.decision = "REVIEW";
      result.reasonCodes.push("INVALID_EXPIRY");
      return result;
    }
    if (expiry < now) {
      result.decision = "EXCLUDE";
      result.reasonCodes.push("EXPIRED");
      return result;
    }
  }
  if (options.target === "external" && candidate.sensitivity === "restricted") {
    result.decision = "EXCLUDE";
    result.reasonCodes.push("SENSITIVE_EXTERNAL_TARGET");
    return result;
  }
  if (options.target === "external" && candidate.sensitivity === "internal") {
    if (options.policy === "broad") result.warnings.push("INTERNAL_MEMORY_ALLOWED_BY_BROAD_POLICY");
    else {
      result.decision = "REVIEW";
      result.reasonCodes.push("INTERNAL_MEMORY_EXTERNAL_TARGET");
      return result;
    }
  }
  if (candidate.conflictsWith.length) {
    result.decision = "REVIEW";
    result.reasonCodes.push("UNRESOLVED_CONFLICT");
    return result;
  }
  if (candidate.invalidEvidenceUris.length) {
    result.decision = "REVIEW";
    result.reasonCodes.push("INVALID_EVIDENCE_URI");
    return result;
  }
  const stateBacked = candidate.source === "approved_project_state";
  if (!stateBacked && candidate.evidenceUris.length === 0) {
    if (options.policy === "broad") {
      result.warnings.push("MISSING_EVIDENCE_ALLOWED_BY_BROAD_POLICY");
    } else if (options.policy === "balanced" && candidate.kind === "task" && ["high", "critical"].includes(candidate.priority)) {
      result.warnings.push("MISSING_EVIDENCE_APPROVED_HIGH_PRIORITY_TASK");
    } else {
      result.decision = "REVIEW";
      result.reasonCodes.push("MISSING_EVIDENCE");
      return result;
    }
  }
  result.reasonCodes.push(candidate.locked ? "LOCKED_APPROVED_MEMORY" : stateBacked ? "APPROVED_PROJECT_STATE" : "EVIDENCE_VERIFIED");
  return result;
}

export function evaluateMemoryGate(candidates, options = {}) {
  const policy = POLICY_VALUES.has(options.policy) ? options.policy : "balanced";
  const target = TARGET_VALUES.has(options.target) ? options.target : "internal";
  const projectId = clean(options.projectId, 300);
  if (!projectId) throw new Error("projectId is required");
  const generatedAt = options.generatedAt || new Date().toISOString();
  const tokenBudget = Math.max(128, Math.floor(Number(options.tokenBudget || 2048)));
  const normalized = (Array.isArray(candidates) ? candidates : []).map(normalizeCandidate);
  const decisions = normalized.map((candidate) => decideCandidate(candidate, { policy, target, projectId, generatedAt }));
  const includable = decisions.filter((row) => row.decision === "INCLUDE").sort((a, b) => stableCandidateSort(a.candidate, b.candidate));
  let usedTokens = 0;
  let budgetOverrun = 0;
  for (const row of includable) {
    const needed = row.candidate.estimatedTokens;
    if (row.candidate.locked) {
      row.allocatedTokens = needed;
      usedTokens += needed;
      if (usedTokens > tokenBudget) budgetOverrun = usedTokens - tokenBudget;
      continue;
    }
    if (usedTokens + needed > tokenBudget) {
      row.decision = "EXCLUDE";
      row.reasonCodes = ["TOKEN_BUDGET"];
      row.allocatedTokens = 0;
      continue;
    }
    row.allocatedTokens = needed;
    usedTokens += needed;
  }
  decisions.sort((a, b) => String(a.candidate.id).localeCompare(String(b.candidate.id)));
  const counts = { INCLUDE: 0, EXCLUDE: 0, REVIEW: 0 };
  for (const row of decisions) counts[row.decision] += 1;
  return {
    format: "kv-archive-memory-gate-report",
    schemaVersion: 1,
    projectId,
    projectTitle: clean(options.projectTitle, 500) || normalized.find((item) => item.projectId === projectId)?.projectTitle || projectId,
    policy,
    target,
    generatedAt,
    tokenBudget,
    usedTokens,
    budgetOverrun,
    counts,
    candidates: decisions,
    included: decisions.filter((row) => row.decision === "INCLUDE"),
    excluded: decisions.filter((row) => row.decision === "EXCLUDE"),
    reviewRequired: decisions.filter((row) => row.decision === "REVIEW"),
  };
}

export function renderMemoryGateMarkdown(report, options = {}) {
  const includeDiagnostics = options.includeDiagnostics !== false;
  const lines = [
    `# ${report.projectTitle} · Memory Gate`,
    "",
    `- Policy: ${report.policy}`,
    `- Target: ${report.target}`,
    `- Token budget: ${report.tokenBudget}`,
    `- Used: ${report.usedTokens}`,
    `- Included / Excluded / Review: ${report.counts.INCLUDE} / ${report.counts.EXCLUDE} / ${report.counts.REVIEW}`,
    report.budgetOverrun ? `- Locked-memory budget overrun: ${report.budgetOverrun}` : "",
    "",
    "## Included memory",
    "",
  ].filter(Boolean);
  if (!report.included.length) lines.push("- None", "");
  for (const row of report.included) {
    lines.push(`### ${row.candidate.title || row.candidate.id}`, "", row.candidate.text || "(empty)", "");
    if (row.candidate.evidenceUris.length) lines.push(...row.candidate.evidenceUris.map((uri) => `- Evidence: ${uri}`), "");
  }
  if (includeDiagnostics) {
    lines.push("## Review required", "");
    if (!report.reviewRequired.length) lines.push("- None", "");
    for (const row of report.reviewRequired) lines.push(`- ${row.candidate.id}: ${row.reasonCodes.join(", ")}`, "");
    lines.push("## Excluded", "");
    if (!report.excluded.length) lines.push("- None", "");
    for (const row of report.excluded) lines.push(`- ${row.candidate.id}: ${row.reasonCodes.join(", ")}`, "");
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function memoryGateManifest(report) {
  return {
    format: report.format,
    schemaVersion: report.schemaVersion,
    projectId: report.projectId,
    projectTitle: report.projectTitle,
    policy: report.policy,
    target: report.target,
    generatedAt: report.generatedAt,
    tokenBudget: report.tokenBudget,
    usedTokens: report.usedTokens,
    budgetOverrun: report.budgetOverrun,
    counts: report.counts,
    files: [
      "memory-gate-report.json",
      "memory-gate-report.md",
      "included-memories.json",
      "excluded-memories.json",
      "review-required.json",
    ],
  };
}
