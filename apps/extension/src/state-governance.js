const PROPOSAL_KINDS = new Set(["project_status", "decision", "task", "supersession"]);
const HEALTH_VALUES = new Set(["unknown", "healthy", "at_risk", "blocked", "completed"]);
const TASK_STATUSES = new Set(["todo", "in_progress", "blocked", "done", "cancelled", "superseded"]);
const TASK_PRIORITIES = new Set(["low", "medium", "high", "critical"]);
const DECISION_STATUSES = new Set(["active", "superseded", "reversed"]);

function cleanText(value, max = 20_000) {
  return String(value ?? "").trim().slice(0, max);
}

function uniqueStrings(values, max = 500) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => cleanText(value, 4_000)).filter(Boolean))].slice(0, max);
}

function clone(value) {
  return structuredClone(value);
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function safePercent(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function safeId(value, fallback = "") {
  return cleanText(value || fallback, 160).replace(/[^a-zA-Z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

function normalizeStatus(value = {}) {
  const health = HEALTH_VALUES.has(value.health) ? value.health : "unknown";
  return {
    summary: cleanText(value.summary, 20_000),
    phase: cleanText(value.phase, 500),
    health,
    progressPercent: safePercent(value.progressPercent),
    blockers: uniqueStrings(value.blockers, 100),
    nextActions: uniqueStrings(value.nextActions, 100),
  };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function normalizeStatusPatch(value = {}) {
  const patch = {};
  if (hasOwn(value, "summary")) patch.summary = cleanText(value.summary, 20_000);
  if (hasOwn(value, "phase")) patch.phase = cleanText(value.phase, 500);
  if (hasOwn(value, "health")) {
    if (!HEALTH_VALUES.has(value.health)) throw new Error(`Invalid project health: ${value.health}`);
    patch.health = value.health;
  }
  if (hasOwn(value, "progressPercent")) patch.progressPercent = safePercent(value.progressPercent);
  if (hasOwn(value, "blockers")) patch.blockers = uniqueStrings(value.blockers, 100);
  if (hasOwn(value, "nextActions")) patch.nextActions = uniqueStrings(value.nextActions, 100);
  if (!Object.keys(patch).length) throw new Error("Project status proposal must change at least one field");
  return patch;
}


function normalizeGovernance(value = {}) {
  return {
    sensitivity: ["public", "internal", "restricted"].includes(value.sensitivity) ? value.sensitivity : "internal",
    expiresAt: cleanText(value.expiresAt, 100) || null,
    conflictsWith: uniqueStrings(value.conflictsWith, 100),
    locked: Boolean(value.locked),
    importance: Math.max(0, Math.min(100, Number(value.importance || 0))),
    scope: cleanText(value.scope, 300) || null,
  };
}

function normalizeDecision(value = {}, fallbackId = "") {
  const id = safeId(value.id, fallbackId);
  if (!id) throw new Error("Decision id is required");
  const title = cleanText(value.title, 500);
  if (!title) throw new Error("Decision title is required");
  return {
    id,
    title,
    summary: cleanText(value.summary, 20_000),
    status: DECISION_STATUSES.has(value.status) ? value.status : "active",
    consequences: uniqueStrings(value.consequences, 100),
    evidenceUris: uniqueStrings(value.evidenceUris, 500),
    createdAt: cleanText(value.createdAt, 100) || null,
    updatedAt: cleanText(value.updatedAt, 100) || null,
    supersededAt: cleanText(value.supersededAt, 100) || null,
    supersededByProposalId: cleanText(value.supersededByProposalId, 200) || null,
    ...normalizeGovernance(value),
  };
}

function normalizeTask(value = {}, fallbackId = "") {
  const id = safeId(value.id, fallbackId);
  if (!id) throw new Error("Task id is required");
  const title = cleanText(value.title, 500);
  if (!title) throw new Error("Task title is required");
  return {
    id,
    title,
    status: TASK_STATUSES.has(value.status) ? value.status : "todo",
    priority: TASK_PRIORITIES.has(value.priority) ? value.priority : "medium",
    owner: cleanText(value.owner, 300) || null,
    dueDate: cleanText(value.dueDate, 100) || null,
    notes: cleanText(value.notes, 20_000),
    evidenceUris: uniqueStrings(value.evidenceUris, 500),
    createdAt: cleanText(value.createdAt, 100) || null,
    updatedAt: cleanText(value.updatedAt, 100) || null,
    supersededAt: cleanText(value.supersededAt, 100) || null,
    supersededByProposalId: cleanText(value.supersededByProposalId, 200) || null,
    ...normalizeGovernance(value),
  };
}

export function stableStateStringify(value) {
  const seen = new WeakSet();
  const normalize = (item) => {
    if (item === null || typeof item !== "object") return item;
    if (seen.has(item)) return "[Circular]";
    seen.add(item);
    if (Array.isArray(item)) return item.map(normalize);
    return Object.fromEntries(Object.keys(item).sort().filter((key) => key !== "stateHash").map((key) => [key, normalize(item[key])]));
  };
  return JSON.stringify(normalize(value));
}

export function createEmptyProjectState(projectId, projectTitle = "") {
  const id = cleanText(projectId, 300);
  if (!id) throw new Error("projectId is required");
  return {
    format: "context-vault-project-state",
    schemaVersion: 1,
    projectId: id,
    projectTitle: cleanText(projectTitle, 500) || id,
    stateVersion: 0,
    stateHash: null,
    updatedAt: null,
    status: normalizeStatus(),
    decisions: [],
    tasks: [],
    supersessions: [],
    lastProposalId: null,
  };
}

export function normalizeProjectState(value = {}) {
  const base = createEmptyProjectState(value.projectId, value.projectTitle);
  return {
    ...base,
    ...clone(value),
    format: "context-vault-project-state",
    schemaVersion: 1,
    projectId: base.projectId,
    projectTitle: cleanText(value.projectTitle, 500) || base.projectTitle,
    stateVersion: Math.max(0, Math.floor(Number(value.stateVersion || 0))),
    stateHash: cleanText(value.stateHash, 200) || null,
    updatedAt: cleanText(value.updatedAt, 100) || null,
    status: normalizeStatus(value.status),
    decisions: (Array.isArray(value.decisions) ? value.decisions : []).map((item) => normalizeDecision(item)),
    tasks: (Array.isArray(value.tasks) ? value.tasks : []).map((item) => normalizeTask(item)),
    supersessions: (Array.isArray(value.supersessions) ? value.supersessions : []).map((item, index) => ({
      id: safeId(item.id, `supersession-${index + 1}`),
      recordType: item.recordType === "task" ? "task" : "decision",
      targetId: cleanText(item.targetId, 200),
      reason: cleanText(item.reason, 20_000),
      proposalId: cleanText(item.proposalId, 200) || null,
      createdAt: cleanText(item.createdAt, 100) || null,
      replacementId: cleanText(item.replacementId, 200) || null,
    })),
    lastProposalId: cleanText(value.lastProposalId, 200) || null,
  };
}

export function parseEvidenceUri(value) {
  const text = cleanText(value, 4_000);
  const conversation = text.match(/^contextvault:\/\/conversation\/([^/]+)\/node\/([^?]+)\?evidence=([^&#]+)$/i);
  const content = text.match(/^contextvault:\/\/content\/([^?]+)\?revision=(\d+)&hash=([^&#]+)$/i);
  try {
    if (conversation) return {
      kind: "conversation",
      uri: text,
      conversationId: decodeURIComponent(conversation[1]),
      nodeId: decodeURIComponent(conversation[2]),
      evidenceHash: decodeURIComponent(conversation[3]),
    };
    if (content) return {
      kind: "content",
      uri: text,
      objectId: decodeURIComponent(content[1]),
      revision: Number(content[2]),
      contentHash: decodeURIComponent(content[3]),
    };
    return null;
  } catch { return null; }
}

function normalizeDecisionPatch(value = {}) {
  const id = safeId(value.id);
  if (!id) throw new Error("Decision id is required for update");
  const patch = { id };
  if (hasOwn(value, "title")) {
    const title = cleanText(value.title, 500);
    if (!title) throw new Error("Decision title cannot be empty");
    patch.title = title;
  }
  if (hasOwn(value, "summary")) patch.summary = cleanText(value.summary, 20_000);
  if (hasOwn(value, "status")) {
    if (!DECISION_STATUSES.has(value.status)) throw new Error(`Invalid decision status: ${value.status}`);
    patch.status = value.status;
  }
  if (hasOwn(value, "consequences")) patch.consequences = uniqueStrings(value.consequences, 100);
  if (hasOwn(value, "evidenceUris")) patch.evidenceUris = uniqueStrings(value.evidenceUris, 500);
  if (hasOwn(value, "sensitivity")) patch.sensitivity = ["public", "internal", "restricted"].includes(value.sensitivity) ? value.sensitivity : "internal";
  if (hasOwn(value, "expiresAt")) patch.expiresAt = cleanText(value.expiresAt, 100) || null;
  if (hasOwn(value, "conflictsWith")) patch.conflictsWith = uniqueStrings(value.conflictsWith, 100);
  if (hasOwn(value, "locked")) patch.locked = Boolean(value.locked);
  if (hasOwn(value, "importance")) patch.importance = Math.max(0, Math.min(100, Number(value.importance || 0)));
  if (hasOwn(value, "scope")) patch.scope = cleanText(value.scope, 300) || null;
  if (Object.keys(patch).length === 1) throw new Error("Decision update must change at least one field");
  return patch;
}

function normalizeTaskPatch(value = {}) {
  const id = safeId(value.id);
  if (!id) throw new Error("Task id is required for update");
  const patch = { id };
  if (hasOwn(value, "title")) {
    const title = cleanText(value.title, 500);
    if (!title) throw new Error("Task title cannot be empty");
    patch.title = title;
  }
  if (hasOwn(value, "status")) {
    if (!TASK_STATUSES.has(value.status)) throw new Error(`Invalid task status: ${value.status}`);
    patch.status = value.status;
  }
  if (hasOwn(value, "priority")) {
    if (!TASK_PRIORITIES.has(value.priority)) throw new Error(`Invalid task priority: ${value.priority}`);
    patch.priority = value.priority;
  }
  if (hasOwn(value, "owner")) patch.owner = cleanText(value.owner, 300) || null;
  if (hasOwn(value, "dueDate")) patch.dueDate = cleanText(value.dueDate, 100) || null;
  if (hasOwn(value, "notes")) patch.notes = cleanText(value.notes, 20_000);
  if (hasOwn(value, "evidenceUris")) patch.evidenceUris = uniqueStrings(value.evidenceUris, 500);
  if (hasOwn(value, "sensitivity")) patch.sensitivity = ["public", "internal", "restricted"].includes(value.sensitivity) ? value.sensitivity : "internal";
  if (hasOwn(value, "expiresAt")) patch.expiresAt = cleanText(value.expiresAt, 100) || null;
  if (hasOwn(value, "conflictsWith")) patch.conflictsWith = uniqueStrings(value.conflictsWith, 100);
  if (hasOwn(value, "locked")) patch.locked = Boolean(value.locked);
  if (hasOwn(value, "importance")) patch.importance = Math.max(0, Math.min(100, Number(value.importance || 0)));
  if (hasOwn(value, "scope")) patch.scope = cleanText(value.scope, 300) || null;
  if (Object.keys(patch).length === 1) throw new Error("Task update must change at least one field");
  return patch;
}

function normalizeProposalChange(kind, value = {}, proposalId = "proposal") {
  if (kind === "project_status") return normalizeStatusPatch(value);
  if (kind === "decision") {
    const action = value.action === "update" ? "update" : "add";
    const source = value.record || value;
    const record = action === "update" ? normalizeDecisionPatch(source) : normalizeDecision(source, `${proposalId}-decision`);
    return { action, record };
  }
  if (kind === "task") {
    const action = value.action === "update" ? "update" : "add";
    const source = value.record || value;
    const record = action === "update" ? normalizeTaskPatch(source) : normalizeTask(source, `${proposalId}-task`);
    return { action, record };
  }
  if (kind === "supersession") {
    const recordType = value.recordType === "task" ? "task" : "decision";
    const targetId = cleanText(value.targetId, 200);
    if (!targetId) throw new Error("Supersession targetId is required");
    let replacement = null;
    if (value.replacement) replacement = recordType === "task"
      ? normalizeTask(value.replacement, `${proposalId}-replacement-task`)
      : normalizeDecision(value.replacement, `${proposalId}-replacement-decision`);
    return { recordType, targetId, reason: cleanText(value.reason, 20_000), replacement };
  }
  throw new Error(`Unsupported proposal kind: ${kind}`);
}

export function normalizeStateProposal(value = {}) {
  if (value.format !== "context-vault-state-proposal") throw new Error("Not a ContextVault state proposal");
  if (Number(value.schemaVersion || value.version) !== 1) throw new Error(`Unsupported state proposal version: ${value.schemaVersion || value.version}`);
  const id = safeId(value.id);
  if (!id) throw new Error("Proposal id is required");
  const kind = cleanText(value.kind, 100);
  if (!PROPOSAL_KINDS.has(kind)) throw new Error(`Unsupported proposal kind: ${kind}`);
  const projectId = cleanText(value.projectId || value.project?.id, 300);
  if (!projectId) throw new Error("Proposal projectId is required");
  const evidenceUris = uniqueStrings(value.evidenceUris, 500);
  if (!evidenceUris.length) throw new Error("At least one evidence URI is required");
  for (const uri of evidenceUris) if (!parseEvidenceUri(uri)) throw new Error(`Invalid evidence URI: ${uri}`);
  const baseVersion = Math.max(0, Math.floor(Number(value.baseVersion ?? value.base?.version ?? 0)));
  const baseStateHash = cleanText(value.baseStateHash || value.base?.stateHash, 200);
  if (!baseStateHash) throw new Error("Proposal baseStateHash is required");
  return {
    format: "context-vault-state-proposal",
    schemaVersion: 1,
    id,
    createdAt: cleanText(value.createdAt, 100) || new Date().toISOString(),
    projectId,
    projectTitle: cleanText(value.projectTitle || value.project?.title, 500) || projectId,
    baseVersion,
    baseStateHash,
    kind,
    title: cleanText(value.title, 500) || kind,
    rationale: cleanText(value.rationale, 20_000),
    expectedImpact: cleanText(value.expectedImpact, 20_000),
    riskLevel: ["low", "medium", "high"].includes(value.riskLevel) ? value.riskLevel : "medium",
    evidenceUris,
    change: normalizeProposalChange(kind, value.change, id),
    agent: {
      name: cleanText(value.agent?.name, 300) || "local-agent",
      bundleId: cleanText(value.agent?.bundleId, 300) || null,
      client: cleanText(value.agent?.client, 300) || null,
    },
  };
}

function addEvidence(existing, proposal) {
  return uniqueStrings([...(existing || []), ...proposal.evidenceUris], 500);
}

function upsertById(rows, record, action, label) {
  const index = rows.findIndex((item) => item.id === record.id);
  if (action === "add" && index >= 0) throw new Error(`${label} already exists: ${record.id}`);
  if (action === "update" && index < 0) throw new Error(`${label} not found: ${record.id}`);
  if (index < 0) rows.push(record);
  else rows[index] = { ...rows[index], ...record };
}

export function applyStateProposal(baseValue, proposalValue, approvedAt = new Date().toISOString()) {
  const state = normalizeProjectState(baseValue);
  const proposal = normalizeStateProposal(proposalValue);
  if (state.projectId !== proposal.projectId) throw new Error("Proposal project does not match current state");
  const next = clone(state);
  if (proposal.kind === "project_status") {
    next.status = normalizeStatus({ ...next.status, ...proposal.change });
  } else if (proposal.kind === "decision") {
    const existing = next.decisions.find((item) => item.id === proposal.change.record.id) || null;
    const merged = proposal.change.action === "update" ? { ...existing, ...proposal.change.record } : proposal.change.record;
    const record = normalizeDecision({ ...merged, evidenceUris: addEvidence(merged.evidenceUris, proposal), updatedAt: approvedAt });
    if (!record.createdAt) record.createdAt = approvedAt;
    upsertById(next.decisions, record, proposal.change.action, "Decision");
  } else if (proposal.kind === "task") {
    const existing = next.tasks.find((item) => item.id === proposal.change.record.id) || null;
    const merged = proposal.change.action === "update" ? { ...existing, ...proposal.change.record } : proposal.change.record;
    const record = normalizeTask({ ...merged, evidenceUris: addEvidence(merged.evidenceUris, proposal), updatedAt: approvedAt });
    if (!record.createdAt) record.createdAt = approvedAt;
    upsertById(next.tasks, record, proposal.change.action, "Task");
  } else if (proposal.kind === "supersession") {
    const rows = proposal.change.recordType === "task" ? next.tasks : next.decisions;
    const target = rows.find((item) => item.id === proposal.change.targetId);
    if (!target) throw new Error(`Supersession target not found: ${proposal.change.targetId}`);
    target.status = proposal.change.recordType === "task" ? "superseded" : "superseded";
    target.supersededAt = approvedAt;
    target.supersededByProposalId = proposal.id;
    let replacementId = null;
    if (proposal.change.replacement) {
      const replacement = { ...proposal.change.replacement, evidenceUris: addEvidence(proposal.change.replacement.evidenceUris, proposal), createdAt: proposal.change.replacement.createdAt || approvedAt, updatedAt: approvedAt };
      upsertById(rows, replacement, "add", proposal.change.recordType === "task" ? "Task" : "Decision");
      replacementId = replacement.id;
    }
    next.supersessions.push({
      id: `${proposal.id}-supersession`,
      recordType: proposal.change.recordType,
      targetId: proposal.change.targetId,
      reason: proposal.change.reason,
      proposalId: proposal.id,
      createdAt: approvedAt,
      replacementId,
    });
  }
  next.stateVersion = state.stateVersion + 1;
  next.updatedAt = approvedAt;
  next.lastProposalId = proposal.id;
  next.stateHash = null;
  return normalizeProjectState(next);
}

function recordMap(rows) {
  return new Map((rows || []).map((row) => [row.id, row]));
}

export function diffProjectStates(beforeValue, afterValue) {
  const before = normalizeProjectState(beforeValue);
  const after = normalizeProjectState(afterValue);
  const changes = [];
  for (const key of ["summary", "phase", "health", "progressPercent", "blockers", "nextActions"]) {
    if (!jsonEqual(before.status[key], after.status[key])) changes.push({ path: `status.${key}`, type: "change", before: before.status[key], after: after.status[key] });
  }
  for (const [collection, label] of [["decisions", "decision"], ["tasks", "task"]]) {
    const left = recordMap(before[collection]);
    const right = recordMap(after[collection]);
    for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
      if (!left.has(id)) changes.push({ path: `${label}.${id}`, type: "add", before: null, after: right.get(id) });
      else if (!right.has(id)) changes.push({ path: `${label}.${id}`, type: "remove", before: left.get(id), after: null });
      else if (!jsonEqual(left.get(id), right.get(id))) changes.push({ path: `${label}.${id}`, type: "change", before: left.get(id), after: right.get(id) });
    }
  }
  if (!jsonEqual(before.supersessions, after.supersessions)) changes.push({ path: "supersessions", type: "change", before: before.supersessions, after: after.supersessions });
  return changes;
}

export function proposalTouchedKeys(proposalValue) {
  const proposal = normalizeStateProposal(proposalValue);
  if (proposal.kind === "project_status") return ["status"];
  if (proposal.kind === "decision") return [`decision:${proposal.change.record.id}`];
  if (proposal.kind === "task") return [`task:${proposal.change.record.id}`];
  const keys = [`${proposal.change.recordType}:${proposal.change.targetId}`];
  if (proposal.change.replacement) keys.push(`${proposal.change.recordType}:${proposal.change.replacement.id}`);
  return keys;
}

function touchedValue(state, key) {
  if (key === "status") return state.status;
  const [type, id] = key.split(":");
  const rows = type === "task" ? state.tasks : state.decisions;
  return rows.find((row) => row.id === id) || null;
}

export function detectProposalConflicts({ proposal: proposalValue, baseState: baseValue, currentState: currentValue }) {
  const proposal = normalizeStateProposal(proposalValue);
  const current = normalizeProjectState(currentValue);
  if (!baseValue) return [{ code: "base_version_missing", path: "state", message: `Base version ${proposal.baseVersion} is unavailable` }];
  const base = normalizeProjectState(baseValue);
  const conflicts = [];
  if (base.stateVersion !== proposal.baseVersion) conflicts.push({ code: "base_version_mismatch", path: "stateVersion", message: `Proposal expects v${proposal.baseVersion}, found v${base.stateVersion}` });
  if (base.stateHash && base.stateHash !== proposal.baseStateHash) conflicts.push({ code: "base_hash_mismatch", path: "stateHash", message: "Proposal base hash does not match stored base version" });
  if (current.stateVersion === proposal.baseVersion && (!current.stateHash || current.stateHash === proposal.baseStateHash)) return conflicts;
  for (const key of proposalTouchedKeys(proposal)) {
    const baseItem = touchedValue(base, key);
    const currentItem = touchedValue(current, key);
    if (!jsonEqual(baseItem, currentItem)) conflicts.push({ code: "concurrent_change", path: key, message: `Current approved state changed at ${key} after the proposal bundle was exported`, base: baseItem, current: currentItem });
  }
  return conflicts;
}

export function proposalKindLabel(kind) {
  return ({ project_status: "项目状态", decision: "决策", task: "任务", supersession: "替代 / 作废" })[kind] || kind;
}

export { PROPOSAL_KINDS };
