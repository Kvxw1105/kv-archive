export const DEFAULT_RESULT_BATCH = 150;
export const DEFAULT_DETAIL_BATCH = 120;

export function pageResultRows(rows = [], limit = DEFAULT_RESULT_BATCH) {
  const safeLimit = Math.max(1, Number(limit) || DEFAULT_RESULT_BATCH);
  return {
    visible: rows.slice(0, safeLimit),
    hasMore: rows.length > safeLimit,
    nextCount: Math.min(DEFAULT_RESULT_BATCH, Math.max(0, rows.length - safeLimit)),
  };
}

export function partitionDetailMessages(messages = [], limit = DEFAULT_DETAIL_BATCH) {
  const safeLimit = Math.max(1, Number(limit) || DEFAULT_DETAIL_BATCH);
  const active = messages.filter((message) => message.activePath);
  const branch = messages.filter((message) => !message.activePath);
  const visibleActive = active.slice(0, safeLimit);
  const remaining = Math.max(0, safeLimit - visibleActive.length);
  const visibleBranch = branch.slice(0, remaining);
  return {
    active,
    branch,
    visibleActive,
    visibleBranch,
    shown: visibleActive.length + visibleBranch.length,
    total: messages.length,
    hasMore: visibleActive.length + visibleBranch.length < messages.length,
  };
}

export function agentBundleScope(filters = {}) {
  return {
    sourceKind: filters.sourceKind || "all",
    projectId: filters.projectId || "all",
    archived: filters.archived || "all",
    dateFrom: filters.dateFrom || "",
    dateTo: filters.dateTo || "",
  };
}

export function ignoredAgentBundleFilters(filters = {}) {
  const ignored = [];
  if (String(filters.query || "").trim()) ignored.push("关键词");
  if (filters.role && filters.role !== "all") ignored.push("角色");
  return ignored;
}
