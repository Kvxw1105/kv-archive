import { CONTEXT_VAULT_STORES, openContextVaultDatabase } from "./db-schema.js";
import { scoreSearchResult, tokenizeText, sha256Hex } from "./vault-index.js";
import { applyStateProposal, createEmptyProjectState, detectProposalConflicts, diffProjectStates, normalizeProjectState, normalizeStateProposal, parseEvidenceUri, stableStateStringify } from "./state-governance.js";

const IMPORTS = CONTEXT_VAULT_STORES.vaultImports;
const CONVERSATIONS = CONTEXT_VAULT_STORES.vaultConversations;
const EVIDENCE = CONTEXT_VAULT_STORES.vaultEvidence;
const MESSAGES = CONTEXT_VAULT_STORES.vaultMessages;
const POSTINGS = CONTEXT_VAULT_STORES.vaultPostings;
const STATE_PROJECTS = CONTEXT_VAULT_STORES.stateProjects;
const STATE_VERSIONS = CONTEXT_VAULT_STORES.stateVersions;
const STATE_PROPOSALS = CONTEXT_VAULT_STORES.stateProposals;
const STATE_EVENTS = CONTEXT_VAULT_STORES.stateEvents;
const MEMORY_PROFILES = CONTEXT_VAULT_STORES.memoryProfiles;
const MEMORY_VERSIONS = CONTEXT_VAULT_STORES.memoryVersions;
const MEMORY_EVENTS = CONTEXT_VAULT_STORES.memoryEvents;
const MEMORY_GATE_CONFIGS = CONTEXT_VAULT_STORES.memoryGateConfigs;
const MEMORY_GATE_RUNS = CONTEXT_VAULT_STORES.memoryGateRuns;
const KNOWLEDGE_EXPORT_PROFILES = CONTEXT_VAULT_STORES.knowledgeExportProfiles;
const KNOWLEDGE_EXPORT_PATHS = CONTEXT_VAULT_STORES.knowledgeExportPaths;
const KNOWLEDGE_EXPORT_RUNS = CONTEXT_VAULT_STORES.knowledgeExportRuns;
const CAPTURE_ITEMS = CONTEXT_VAULT_STORES.captureItems;
const CAPTURE_VERSIONS = CONTEXT_VAULT_STORES.captureVersions;

function openDatabase() {
  return openContextVaultDatabase("无法打开本地资料库");
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本地资料库操作失败"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("本地资料库事务失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("本地资料库事务已取消"));
  });
}

async function keysForIndex(db, storeName, indexName, value) {
  const tx = db.transaction(storeName, "readonly");
  return requestResult(tx.objectStore(storeName).index(indexName).getAllKeys(IDBKeyRange.only(value)));
}

async function recordsForKeys(db, storeName, keys, batchSize = 250) {
  const values = [];
  for (let offset = 0; offset < keys.length; offset += batchSize) {
    const batch = keys.slice(offset, offset + batchSize);
    const tx = db.transaction(storeName, "readonly");
    const done = transactionDone(tx);
    const store = tx.objectStore(storeName);
    const rows = await Promise.all(batch.map((key) => requestResult(store.get(key))));
    await done;
    values.push(...rows.filter(Boolean));
  }
  return values;
}

async function recordsForIndexValues(db, storeName, indexName, values, batchSize = 50) {
  const rows = [];
  for (let offset = 0; offset < values.length; offset += batchSize) {
    const batch = values.slice(offset, offset + batchSize);
    const tx = db.transaction(storeName, "readonly");
    const done = transactionDone(tx);
    const index = tx.objectStore(storeName).index(indexName);
    const groups = await Promise.all(batch.map((value) => requestResult(index.getAll(IDBKeyRange.only(value)))));
    await done;
    for (const group of groups) rows.push(...group);
  }
  return rows;
}

function mergeUnique(left = [], right = []) {
  return [...new Set([...left, ...right].filter(Boolean))];
}

function isIncomingStale(existing, incoming) {
  if (!existing) return false;
  const current = Date.parse(existing.updatedAt || existing.createdAt || "");
  const next = Date.parse(incoming.updatedAt || incoming.createdAt || "");
  return Number.isFinite(current) && Number.isFinite(next) && next < current;
}

function applyFilters(message, conversation, filters) {
  if (filters.role && filters.role !== "all" && message.role !== filters.role) return false;
  if (filters.sourceKind && filters.sourceKind !== "all" && !conversation.sourceKinds?.includes(filters.sourceKind)) return false;
  if (filters.projectId && filters.projectId !== "all" && conversation.projectId !== filters.projectId) return false;
  if (filters.archived === "archived" && !conversation.archived) return false;
  if (filters.archived === "active" && conversation.archived) return false;
  const value = Date.parse(message.createdAt || conversation.updatedAt || conversation.createdAt || "");
  if (filters.dateFrom) {
    const from = Date.parse(`${filters.dateFrom}T00:00:00`);
    if (Number.isFinite(from) && (!Number.isFinite(value) || value < from)) return false;
  }
  if (filters.dateTo) {
    const to = Date.parse(`${filters.dateTo}T23:59:59.999`);
    if (Number.isFinite(to) && (!Number.isFinite(value) || value > to)) return false;
  }
  return true;
}

function sortConversations(rows) {
  return rows.sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0) || a.title.localeCompare(b.title, "zh-CN"));
}


function versionKey(projectId, version) { return `${projectId}:v${version}`; }
function auditId(prefix = "event") { return `${prefix}:${Date.now()}:${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`; }
async function stateWithHash(value) {
  const state = normalizeProjectState(value);
  state.stateHash = await sha256Hex(stableStateStringify(state));
  return state;
}
function versionRecord(state, metadata = {}) {
  return {
    key: versionKey(state.projectId, state.stateVersion),
    projectId: state.projectId,
    projectTitle: state.projectTitle,
    version: state.stateVersion,
    stateHash: state.stateHash,
    createdAt: metadata.createdAt || state.updatedAt || new Date().toISOString(),
    action: metadata.action || "approved",
    proposalId: metadata.proposalId || null,
    reviewerNote: metadata.reviewerNote || "",
    rollbackFromVersion: metadata.rollbackFromVersion ?? null,
    snapshot: structuredClone(state),
  };
}
async function emptyStateWithHash(projectId, projectTitle) { return stateWithHash(createEmptyProjectState(projectId, projectTitle)); }

async function readCurrentState(db, projectId, projectTitle = "") {
  const tx = db.transaction(STATE_PROJECTS, "readonly");
  const existing = await requestResult(tx.objectStore(STATE_PROJECTS).get(projectId));
  return existing ? normalizeProjectState(existing) : emptyStateWithHash(projectId, projectTitle);
}

async function readStateVersion(db, projectId, version, projectTitle = "") {
  if (Number(version) === 0) return emptyStateWithHash(projectId, projectTitle);
  const tx = db.transaction(STATE_VERSIONS, "readonly");
  const row = await requestResult(tx.objectStore(STATE_VERSIONS).get(versionKey(projectId, version)));
  return row?.snapshot ? normalizeProjectState(row.snapshot) : null;
}

async function verifyEvidenceUri(db, uri) {
  const parsed = parseEvidenceUri(uri);
  if (!parsed) return { ok: false, uri, reason: "invalid_uri" };
  if (parsed.kind === "content") {
    const tx = db.transaction([CAPTURE_ITEMS, CAPTURE_VERSIONS], "readonly");
    const [current, version] = await Promise.all([
      requestResult(tx.objectStore(CAPTURE_ITEMS).get(parsed.objectId)),
      requestResult(tx.objectStore(CAPTURE_VERSIONS).get(`${parsed.objectId}:v${parsed.revision}`)),
    ]);
    const snapshot = current?.revision === parsed.revision ? current : version?.snapshot;
    if (!snapshot) return { ok: false, uri, reason: "content_version_not_found" };
    if (snapshot.contentHash !== parsed.contentHash) return { ok: false, uri, reason: "content_hash_mismatch" };
    return { ok: true, uri, objectId: parsed.objectId, revision: parsed.revision, contentHash: parsed.contentHash };
  }
  const conversationKey = `chatgpt:${parsed.conversationId}`;
  const tx = db.transaction(EVIDENCE, "readonly");
  const rows = await requestResult(tx.objectStore(EVIDENCE).index("conversationKey").getAll(IDBKeyRange.only(conversationKey)));
  const evidence = rows.find((row) => row.evidenceHash === parsed.evidenceHash);
  if (!evidence) return { ok: false, uri, reason: "evidence_not_found" };
  if (!evidence.canonical?.nodes?.[parsed.nodeId]) return { ok: false, uri, reason: "node_not_found" };
  return { ok: true, uri, conversationId: parsed.conversationId, nodeId: parsed.nodeId, evidenceHash: parsed.evidenceHash };
}

function cleanReviewerNote(value) { return String(value || "").trim().slice(0, 20_000); }
function sortProposals(rows) {
  const statusOrder = { pending: 0, conflicted: 1, approved: 2, rejected: 3 };
  return rows.sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) || Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
}

export function createIndexedDbLibraryStore() {
  return {
    async upsertBundle(bundle) {
      const db = await openDatabase();
      try {
        const readTx = db.transaction(CONVERSATIONS, "readonly");
        const existing = await requestResult(readTx.objectStore(CONVERSATIONS).get(bundle.conversation.key));
        const status = !existing ? "inserted" : existing.currentEvidenceHash === bundle.conversation.currentEvidenceHash ? "duplicate" : isIncomingStale(existing, bundle.conversation) ? "stale" : "updated";
        const mergedConversation = status === "stale" ? {
          ...existing,
          sourceKinds: mergeUnique(existing?.sourceKinds, bundle.conversation.sourceKinds),
          sourceFiles: mergeUnique(existing?.sourceFiles, bundle.conversation.sourceFiles),
        } : {
          ...(existing || {}),
          ...bundle.conversation,
          sourceKinds: mergeUnique(existing?.sourceKinds, bundle.conversation.sourceKinds),
          sourceFiles: mergeUnique(existing?.sourceFiles, bundle.conversation.sourceFiles),
        };
        if (status === "duplicate" || status === "stale") {
          const tx = db.transaction([CONVERSATIONS, EVIDENCE], "readwrite");
          tx.objectStore(CONVERSATIONS).put(mergedConversation);
          tx.objectStore(EVIDENCE).put(bundle.evidence);
          await transactionDone(tx);
          return { status };
        }
        const oldMessageKeys = existing ? await keysForIndex(db, MESSAGES, "conversationKey", bundle.conversation.key) : [];
        const oldPostingKeys = existing ? await keysForIndex(db, POSTINGS, "conversationKey", bundle.conversation.key) : [];
        const tx = db.transaction([CONVERSATIONS, EVIDENCE, MESSAGES, POSTINGS], "readwrite");
        const conversations = tx.objectStore(CONVERSATIONS);
        const evidence = tx.objectStore(EVIDENCE);
        const messages = tx.objectStore(MESSAGES);
        const postings = tx.objectStore(POSTINGS);
        conversations.put(mergedConversation);
        evidence.put(bundle.evidence);
        for (const key of oldMessageKeys) messages.delete(key);
        for (const key of oldPostingKeys) postings.delete(key);
        for (const row of bundle.messages) messages.put(row);
        for (const row of bundle.postings) postings.put(row);
        await transactionDone(tx);
        return { status };
      } finally { db.close(); }
    },

    async putImport(record) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(IMPORTS, "readwrite");
        tx.objectStore(IMPORTS).put(structuredClone(record));
        await transactionDone(tx);
      } finally { db.close(); }
    },

    async getStats() {
      const db = await openDatabase();
      try {
        const tx = db.transaction([CONVERSATIONS, MESSAGES, EVIDENCE, IMPORTS, STATE_PROJECTS, STATE_VERSIONS, STATE_PROPOSALS, STATE_EVENTS], "readonly");
        const [conversations, messages, evidence, imports, states, versions, proposals, events, pending, conflicted] = await Promise.all([
          requestResult(tx.objectStore(CONVERSATIONS).count()),
          requestResult(tx.objectStore(MESSAGES).count()),
          requestResult(tx.objectStore(EVIDENCE).count()),
          requestResult(tx.objectStore(IMPORTS).count()),
          requestResult(tx.objectStore(STATE_PROJECTS).count()),
          requestResult(tx.objectStore(STATE_VERSIONS).count()),
          requestResult(tx.objectStore(STATE_PROPOSALS).count()),
          requestResult(tx.objectStore(STATE_EVENTS).count()),
          requestResult(tx.objectStore(STATE_PROPOSALS).index("status").count(IDBKeyRange.only("pending"))),
          requestResult(tx.objectStore(STATE_PROPOSALS).index("status").count(IDBKeyRange.only("conflicted"))),
        ]);
        return { conversations, messages, evidence, imports, states, versions, proposals, events, pendingProposals: pending, conflictedProposals: conflicted };
      } finally { db.close(); }
    },

    async listProjects() {
      const db = await openDatabase();
      try {
        const tx = db.transaction(CONVERSATIONS, "readonly");
        const rows = await requestResult(tx.objectStore(CONVERSATIONS).getAll());
        const projects = new Map();
        for (const row of rows) if (row.projectId) projects.set(row.projectId, { id: row.projectId, title: row.projectTitle || row.projectId });
        return [...projects.values()].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
      } finally { db.close(); }
    },

    async listConversations(filters = {}) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(CONVERSATIONS, "readonly");
        const rows = await requestResult(tx.objectStore(CONVERSATIONS).getAll());
        return sortConversations(rows.filter((conversation) => {
          if (filters.sourceKind && filters.sourceKind !== "all" && !conversation.sourceKinds?.includes(filters.sourceKind)) return false;
          if (filters.projectId && filters.projectId !== "all" && conversation.projectId !== filters.projectId) return false;
          if (filters.archived === "archived" && !conversation.archived) return false;
          if (filters.archived === "active" && conversation.archived) return false;
          const value = Date.parse(conversation.updatedAt || conversation.createdAt || "");
          if (filters.dateFrom && value < Date.parse(`${filters.dateFrom}T00:00:00`)) return false;
          if (filters.dateTo && value > Date.parse(`${filters.dateTo}T23:59:59.999`)) return false;
          return true;
        })).slice(0, filters.limit || 200);
      } finally { db.close(); }
    },

    async search(filters = {}) {
      const query = String(filters.query || "").trim();
      if (!query) return { query, results: [], conversations: await this.listConversations(filters) };
      const tokens = tokenizeText(query);
      const db = await openDatabase();
      try {
        let candidateKeys = null;
        for (const token of tokens) {
          const tx = db.transaction(POSTINGS, "readonly");
          const rows = await requestResult(tx.objectStore(POSTINGS).index("token").getAll(IDBKeyRange.only(token)));
          const keys = new Set(rows.map((row) => row.messageKey));
          if (candidateKeys === null) candidateKeys = keys;
          else candidateKeys = new Set([...candidateKeys].filter((key) => keys.has(key)));
          if (candidateKeys.size === 0) break;
        }
        if (!candidateKeys || candidateKeys.size === 0) return { query, results: [], conversations: [] };
        // Do not silently discard matches after an arbitrary threshold. Read
        // candidate messages in bounded batches so large archives remain
        // complete without creating thousands of concurrent IDB requests.
        const messages = await recordsForKeys(db, MESSAGES, [...candidateKeys]);
        const conversationKeys = [...new Set(messages.map((item) => item.conversationKey))];
        const conversations = new Map((await recordsForKeys(db, CONVERSATIONS, conversationKeys)).map((row) => [row.key, row]));
        const results = messages.map((message) => ({ message, conversation: conversations.get(message.conversationKey), score: scoreSearchResult(message, query) }))
          .filter((item) => item.conversation && applyFilters(item.message, item.conversation, filters) && item.score > 0)
          .sort((a, b) => b.score - a.score || Date.parse(b.conversation.updatedAt || 0) - Date.parse(a.conversation.updatedAt || 0))
          .slice(0, filters.limit || 100);
        return { query, results, conversations: [] };
      } finally { db.close(); }
    },

    async exportAgentRecords(filters = {}) {
      const db = await openDatabase();
      try {
        const projectId = filters.projectId && filters.projectId !== "all" ? filters.projectId : null;
        const tx = db.transaction([CONVERSATIONS, STATE_PROJECTS, CAPTURE_ITEMS], "readonly");
        const done = transactionDone(tx);
        const conversationStore = tx.objectStore(CONVERSATIONS);
        const stateStore = tx.objectStore(STATE_PROJECTS);
        const captureStore = tx.objectStore(CAPTURE_ITEMS);
        const [allConversations, stateSelection, allCaptureItems] = await Promise.all([
          projectId
            ? requestResult(conversationStore.index("projectId").getAll(IDBKeyRange.only(projectId)))
            : requestResult(conversationStore.getAll()),
          projectId
            ? requestResult(stateStore.get(projectId))
            : requestResult(stateStore.getAll()),
          projectId
            ? requestResult(captureStore.index("projectId").getAll(IDBKeyRange.only(projectId)))
            : requestResult(captureStore.getAll()),
        ]);
        await done;
        const allStates = projectId ? (stateSelection ? [stateSelection] : []) : stateSelection;
        const conversations = sortConversations(allConversations.filter((conversation) => {
          if (filters.sourceKind && filters.sourceKind !== "all" && !conversation.sourceKinds?.includes(filters.sourceKind)) return false;
          if (filters.projectId && filters.projectId !== "all" && conversation.projectId !== filters.projectId) return false;
          if (filters.archived === "archived" && !conversation.archived) return false;
          if (filters.archived === "active" && conversation.archived) return false;
          const value = Date.parse(conversation.updatedAt || conversation.createdAt || "");
          if (filters.dateFrom && value < Date.parse(`${filters.dateFrom}T00:00:00`)) return false;
          if (filters.dateTo && value > Date.parse(`${filters.dateTo}T23:59:59.999`)) return false;
          return true;
        }));
        const conversationKeys = conversations.map((row) => row.key);
        const evidenceKeys = [...new Set(conversations.map((row) => row.currentEvidenceKey).filter(Boolean))];
        const messages = await recordsForIndexValues(db, MESSAGES, "conversationKey", conversationKeys);
        const evidence = await recordsForKeys(db, EVIDENCE, evidenceKeys);
        const projectMap = new Map(conversations.filter((row) => row.projectId).map((row) => [row.projectId, row.projectTitle || row.projectId]));
        for (const row of allCaptureItems) {
          if (!row.projectId) continue;
          if (filters.projectId && filters.projectId !== "all" && row.projectId !== filters.projectId) continue;
          projectMap.set(row.projectId, row.projectTitle || row.projectId);
        }
        const currentByProject = new Map(allStates.map((row) => [row.projectId, normalizeProjectState(row)]));
        if (filters.projectId && filters.projectId !== "all" && currentByProject.has(filters.projectId)) {
          const selected = currentByProject.get(filters.projectId);
          projectMap.set(filters.projectId, selected.projectTitle || filters.projectId);
        }
        const states = [];
        for (const [projectId, projectTitle] of projectMap) states.push(currentByProject.get(projectId) || await emptyStateWithHash(projectId, projectTitle));
        return { conversations, messages, evidence, states };
      } finally { db.close(); }
    },

    async listStateProjects() {
      const db = await openDatabase();
      try {
        const tx = db.transaction([CONVERSATIONS, STATE_PROJECTS, STATE_PROPOSALS, CAPTURE_ITEMS], "readonly");
        const [conversations, states, proposals, captureItems] = await Promise.all([
          requestResult(tx.objectStore(CONVERSATIONS).getAll()),
          requestResult(tx.objectStore(STATE_PROJECTS).getAll()),
          requestResult(tx.objectStore(STATE_PROPOSALS).getAll()),
          requestResult(tx.objectStore(CAPTURE_ITEMS).getAll()),
        ]);
        const projects = new Map();
        for (const row of conversations) if (row.projectId) projects.set(row.projectId, { id: row.projectId, title: row.projectTitle || row.projectId });
        for (const row of states) projects.set(row.projectId, { id: row.projectId, title: row.projectTitle || row.projectId });
        for (const row of proposals) projects.set(row.projectId, { id: row.projectId, title: row.projectTitle || row.projectId });
        for (const row of captureItems) if (row.projectId) projects.set(row.projectId, { id: row.projectId, title: row.projectTitle || row.projectId });
        return [...projects.values()].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
      } finally { db.close(); }
    },

    async getProjectState(projectId, projectTitle = "") {
      const db = await openDatabase();
      try { return readCurrentState(db, projectId, projectTitle); }
      finally { db.close(); }
    },

    async listStateVersions(projectId) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(STATE_VERSIONS, "readonly");
        const rows = await requestResult(tx.objectStore(STATE_VERSIONS).index("projectId").getAll(IDBKeyRange.only(projectId)));
        return rows.sort((a, b) => b.version - a.version);
      } finally { db.close(); }
    },

    async listStateEvents(projectId) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(STATE_EVENTS, "readonly");
        const rows = projectId ? await requestResult(tx.objectStore(STATE_EVENTS).index("projectId").getAll(IDBKeyRange.only(projectId))) : await requestResult(tx.objectStore(STATE_EVENTS).getAll());
        return rows.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
      } finally { db.close(); }
    },

    async listStateProposals(filters = {}) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(STATE_PROPOSALS, "readonly");
        const rows = filters.projectId ? await requestResult(tx.objectStore(STATE_PROPOSALS).index("projectId").getAll(IDBKeyRange.only(filters.projectId))) : await requestResult(tx.objectStore(STATE_PROPOSALS).getAll());
        return sortProposals(rows.filter((row) => !filters.status || filters.status === "all" || row.status === filters.status));
      } finally { db.close(); }
    },

    async importStateProposal(value) {
      const proposal = normalizeStateProposal(value);
      const db = await openDatabase();
      try {
        const existingTx = db.transaction(STATE_PROPOSALS, "readonly");
        const existing = await requestResult(existingTx.objectStore(STATE_PROPOSALS).get(proposal.id));
        if (existing) return { status: "duplicate", proposal: existing };
        const evidenceChecks = [];
        for (const uri of proposal.evidenceUris) evidenceChecks.push(await verifyEvidenceUri(db, uri));
        const invalidEvidence = evidenceChecks.filter((row) => !row.ok);
        if (invalidEvidence.length) throw new Error(`Proposal evidence validation failed: ${invalidEvidence.map((row) => `${row.reason}:${row.uri}`).join(", ")}`);
        const current = await readCurrentState(db, proposal.projectId, proposal.projectTitle);
        const base = await readStateVersion(db, proposal.projectId, proposal.baseVersion, proposal.projectTitle);
        const conflicts = detectProposalConflicts({ proposal, baseState: base, currentState: current });
        const record = {
          ...proposal,
          status: conflicts.length ? "conflicted" : "pending",
          importedAt: new Date().toISOString(),
          evidenceChecks,
          conflicts,
          reviewedAt: null,
          reviewerNote: "",
          approvedVersion: null,
        };
        const tx = db.transaction([STATE_PROPOSALS, STATE_EVENTS], "readwrite");
        tx.objectStore(STATE_PROPOSALS).put(record);
        tx.objectStore(STATE_EVENTS).put({ id: auditId("proposal-imported"), projectId: proposal.projectId, proposalId: proposal.id, type: "proposal_imported", createdAt: record.importedAt, details: { status: record.status, kind: proposal.kind, conflicts: conflicts.length } });
        await transactionDone(tx);
        return { status: record.status, proposal: record };
      } finally { db.close(); }
    },

    async getStateProposalReview(id) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(STATE_PROPOSALS, "readonly");
        const proposal = await requestResult(tx.objectStore(STATE_PROPOSALS).get(id));
        if (!proposal) return null;
        const current = await readCurrentState(db, proposal.projectId, proposal.projectTitle);
        const base = await readStateVersion(db, proposal.projectId, proposal.baseVersion, proposal.projectTitle);
        const conflicts = detectProposalConflicts({ proposal, baseState: base, currentState: current });
        let candidate = null;
        let diff = [];
        let previewError = null;
        try {
          candidate = applyStateProposal(current, proposal, proposal.createdAt || new Date().toISOString());
          diff = diffProjectStates(current, candidate);
        } catch (error) { previewError = error instanceof Error ? error.message : String(error); }
        return { proposal: { ...proposal, status: conflicts.length && proposal.status === "pending" ? "conflicted" : proposal.status }, current, base, candidate, diff, conflicts, previewError };
      } finally { db.close(); }
    },

    async approveStateProposal(id, reviewerNote = "") {
      const db = await openDatabase();
      try {
        const readTx = db.transaction(STATE_PROPOSALS, "readonly");
        const proposal = await requestResult(readTx.objectStore(STATE_PROPOSALS).get(id));
        if (!proposal) throw new Error(`Proposal not found: ${id}`);
        if (["approved", "rejected"].includes(proposal.status)) throw new Error(`Proposal is already ${proposal.status}`);
        const current = await readCurrentState(db, proposal.projectId, proposal.projectTitle);
        const base = await readStateVersion(db, proposal.projectId, proposal.baseVersion, proposal.projectTitle);
        const conflicts = detectProposalConflicts({ proposal, baseState: base, currentState: current });
        if (conflicts.length) throw new Error(`Proposal has unresolved conflicts: ${conflicts.map((item) => item.path).join(", ")}`);
        const reviewedAt = new Date().toISOString();
        const next = await stateWithHash(applyStateProposal(current, proposal, reviewedAt));
        const approvedProposal = { ...proposal, status: "approved", reviewedAt, reviewerNote: cleanReviewerNote(reviewerNote), approvedVersion: next.stateVersion, conflicts: [] };
        const tx = db.transaction([STATE_PROJECTS, STATE_VERSIONS, STATE_PROPOSALS, STATE_EVENTS], "readwrite");
        const proposalStore = tx.objectStore(STATE_PROPOSALS);
        const projectStore = tx.objectStore(STATE_PROJECTS);
        const [lockedProposal, lockedState] = await Promise.all([
          requestResult(proposalStore.get(id)),
          requestResult(projectStore.get(proposal.projectId)),
        ]);
        const proposalChanged = !lockedProposal || lockedProposal.status !== proposal.status || lockedProposal.importedAt !== proposal.importedAt;
        const stateChanged = lockedState
          ? lockedState.stateVersion !== current.stateVersion || lockedState.stateHash !== current.stateHash
          : current.stateVersion !== 0;
        if (proposalChanged || stateChanged) {
          tx.abort();
          throw new Error("Proposal or approved state changed during review. Refresh and review again.");
        }
        if (current.stateVersion === 0) tx.objectStore(STATE_VERSIONS).put(versionRecord(current, { action: "initial", createdAt: reviewedAt }));
        projectStore.put(next);
        tx.objectStore(STATE_VERSIONS).put(versionRecord(next, { action: "approved", proposalId: proposal.id, reviewerNote: approvedProposal.reviewerNote, createdAt: reviewedAt }));
        proposalStore.put(approvedProposal);
        tx.objectStore(STATE_EVENTS).put({ id: auditId("proposal-approved"), projectId: proposal.projectId, proposalId: proposal.id, type: "proposal_approved", createdAt: reviewedAt, details: { fromVersion: current.stateVersion, toVersion: next.stateVersion, kind: proposal.kind, reviewerNote: approvedProposal.reviewerNote } });
        await transactionDone(tx);
        return { proposal: approvedProposal, state: next, diff: diffProjectStates(current, next) };
      } finally { db.close(); }
    },

    async rejectStateProposal(id, reviewerNote = "") {
      const db = await openDatabase();
      try {
        const reviewedAt = new Date().toISOString();
        const tx = db.transaction([STATE_PROPOSALS, STATE_EVENTS], "readwrite");
        const proposalStore = tx.objectStore(STATE_PROPOSALS);
        const proposal = await requestResult(proposalStore.get(id));
        if (!proposal) { tx.abort(); throw new Error(`Proposal not found: ${id}`); }
        if (proposal.status === "approved") { tx.abort(); throw new Error("Approved proposal cannot be rejected"); }
        if (proposal.status === "rejected") { await transactionDone(tx); return proposal; }
        const rejected = { ...proposal, status: "rejected", reviewedAt, reviewerNote: cleanReviewerNote(reviewerNote) };
        proposalStore.put(rejected);
        tx.objectStore(STATE_EVENTS).put({ id: auditId("proposal-rejected"), projectId: proposal.projectId, proposalId: proposal.id, type: "proposal_rejected", createdAt: reviewedAt, details: { kind: proposal.kind, reviewerNote: rejected.reviewerNote } });
        await transactionDone(tx);
        return rejected;
      } finally { db.close(); }
    },

    async rollbackProjectState(projectId, targetVersion, reviewerNote = "") {
      const db = await openDatabase();
      try {
        const current = await readCurrentState(db, projectId);
        const target = await readStateVersion(db, projectId, targetVersion, current.projectTitle);
        if (!target) throw new Error(`State version not found: v${targetVersion}`);
        if (target.stateVersion === current.stateVersion) throw new Error("Target version is already current");
        const createdAt = new Date().toISOString();
        const restored = await stateWithHash({ ...structuredClone(target), stateVersion: current.stateVersion + 1, updatedAt: createdAt, lastProposalId: null });
        const note = cleanReviewerNote(reviewerNote);
        const tx = db.transaction([STATE_PROJECTS, STATE_VERSIONS, STATE_EVENTS], "readwrite");
        const projectStore = tx.objectStore(STATE_PROJECTS);
        const lockedState = await requestResult(projectStore.get(projectId));
        const stateChanged = lockedState
          ? lockedState.stateVersion !== current.stateVersion || lockedState.stateHash !== current.stateHash
          : current.stateVersion !== 0;
        if (stateChanged) {
          tx.abort();
          throw new Error("Approved state changed during rollback review. Refresh and review again.");
        }
        projectStore.put(restored);
        tx.objectStore(STATE_VERSIONS).put(versionRecord(restored, { action: "rollback", createdAt, rollbackFromVersion: targetVersion, reviewerNote: note }));
        tx.objectStore(STATE_EVENTS).put({ id: auditId("state-rollback"), projectId, proposalId: null, type: "state_rollback", createdAt, details: { fromVersion: current.stateVersion, restoredFromVersion: targetVersion, toVersion: restored.stateVersion, reviewerNote: note } });
        await transactionDone(tx);
        return { state: restored, diff: diffProjectStates(current, restored) };
      } finally { db.close(); }
    },


    async getApprovedMemory(projectId) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(MEMORY_PROFILES, "readonly");
        return await requestResult(tx.objectStore(MEMORY_PROFILES).get(projectId)) || null;
      } finally { db.close(); }
    },

    async listMemoryVersions(projectId) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(MEMORY_VERSIONS, "readonly");
        const rows = await requestResult(tx.objectStore(MEMORY_VERSIONS).index("projectId").getAll(IDBKeyRange.only(projectId)));
        return rows.sort((a, b) => b.version - a.version);
      } finally { db.close(); }
    },

    async approveMemoryPackage(candidate, reviewerNote = "") {
      if (!candidate?.projectId || !candidate?.core?.markdown || !candidate?.project?.markdown) throw new Error("Memory candidate is incomplete");
      const db = await openDatabase();
      try {
        const readTx = db.transaction(MEMORY_PROFILES, "readonly");
        const current = await requestResult(readTx.objectStore(MEMORY_PROFILES).get(candidate.projectId));
        if (current?.hash === candidate.hash) return current;
        const currentState = await readCurrentState(db, candidate.projectId, candidate.projectTitle);
        if (Number(currentState.stateVersion || 0) !== Number(candidate.sourceStateVersion || 0) || (currentState.stateHash || null) !== (candidate.sourceStateHash || null)) {
          throw new Error("Project state changed after memory generation. Regenerate and review again.");
        }
        const approvedAt = new Date().toISOString();
        const version = Number(current?.version || 0) + 1;
        const record = {
          format: "context-vault-approved-memory", schemaVersion: 1,
          projectId: candidate.projectId, projectTitle: candidate.projectTitle || candidate.projectId,
          version, hash: candidate.hash, approvedAt, reviewerNote: cleanReviewerNote(reviewerNote),
          sourceStateVersion: candidate.sourceStateVersion || 0, sourceStateHash: candidate.sourceStateHash || null,
          core: structuredClone(candidate.core), project: structuredClone(candidate.project),
        };
        const tx = db.transaction([MEMORY_PROFILES, MEMORY_VERSIONS, MEMORY_EVENTS, STATE_PROJECTS], "readwrite");
        const [locked, lockedState] = await Promise.all([
          requestResult(tx.objectStore(MEMORY_PROFILES).get(candidate.projectId)),
          requestResult(tx.objectStore(STATE_PROJECTS).get(candidate.projectId)),
        ]);
        const stateChanged = lockedState
          ? Number(lockedState.stateVersion || 0) !== Number(candidate.sourceStateVersion || 0) || (lockedState.stateHash || null) !== (candidate.sourceStateHash || null)
          : Number(candidate.sourceStateVersion || 0) !== 0;
        if ((locked?.version || 0) !== (current?.version || 0) || (locked?.hash || null) !== (current?.hash || null) || stateChanged) {
          tx.abort();
          throw new Error("Memory or Project state changed during review. Refresh and review again.");
        }
        tx.objectStore(MEMORY_PROFILES).put(record);
        tx.objectStore(MEMORY_VERSIONS).put({ key: `${candidate.projectId}:v${version}`, ...record });
        tx.objectStore(MEMORY_EVENTS).put({ id: auditId("memory-approved"), projectId: candidate.projectId, type: "memory_approved", createdAt: approvedAt, details: { version, hash: candidate.hash, reviewerNote: record.reviewerNote } });
        await transactionDone(tx);
        return record;
      } finally { db.close(); }
    },

    async getMemoryGateConfig(projectId) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(MEMORY_GATE_CONFIGS, "readonly");
        return await requestResult(tx.objectStore(MEMORY_GATE_CONFIGS).get(projectId)) || null;
      } finally { db.close(); }
    },

    async saveMemoryGateConfig(value) {
      if (!value?.projectId) throw new Error("Memory Gate config projectId is required");
      const db = await openDatabase();
      try {
        const readTx = db.transaction(MEMORY_GATE_CONFIGS, "readonly");
        const current = await requestResult(readTx.objectStore(MEMORY_GATE_CONFIGS).get(value.projectId));
        const updatedAt = new Date().toISOString();
        const record = {
          format: "kv-archive-memory-gate-config", schemaVersion: 1,
          projectId: value.projectId, projectTitle: value.projectTitle || value.projectId,
          version: Number(current?.version || 0) + 1,
          policy: ["safe","balanced","broad"].includes(value.policy) ? value.policy : "balanced",
          target: ["internal","external"].includes(value.target) ? value.target : "internal",
          tokenBudget: Math.max(128, Math.floor(Number(value.tokenBudget || 2048))),
          overrides: structuredClone(value.overrides || {}),
          rollbackFromRunId: value.rollbackFromRunId || null,
          updatedAt,
        };
        record.hash = await sha256Hex(record);
        const tx = db.transaction(MEMORY_GATE_CONFIGS, "readwrite");
        tx.objectStore(MEMORY_GATE_CONFIGS).put(record);
        await transactionDone(tx);
        return record;
      } finally { db.close(); }
    },

    async saveMemoryGateRun(value) {
      if (!value?.projectId || !value?.report) throw new Error("Memory Gate run is incomplete");
      const db = await openDatabase();
      try {
        const createdAt = value.createdAt || new Date().toISOString();
        const id = value.id || `memory-gate-run:${value.projectId}:${createdAt}:${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
        const record = { format:"kv-archive-memory-gate-run", schemaVersion:1, ...structuredClone(value), id, createdAt };
        record.hash = await sha256Hex({ projectId:record.projectId, createdAt, config:record.config, report:record.report });
        const tx = db.transaction(MEMORY_GATE_RUNS, "readwrite");
        const runs = tx.objectStore(MEMORY_GATE_RUNS);
        const existing = await requestResult(runs.get(id));
        if (existing) { tx.abort(); throw new Error(`Memory Gate run receipt already exists: ${id}`); }
        runs.add(record);
        await transactionDone(tx);
        return record;
      } finally { db.close(); }
    },

    async listMemoryGateRuns(projectId) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(MEMORY_GATE_RUNS, "readonly");
        const rows = await requestResult(tx.objectStore(MEMORY_GATE_RUNS).index("projectId").getAll(IDBKeyRange.only(projectId)));
        return rows.sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0));
      } finally { db.close(); }
    },

    async restoreMemoryGateConfigFromRun(runId) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(MEMORY_GATE_RUNS, "readonly");
        const run = await requestResult(tx.objectStore(MEMORY_GATE_RUNS).get(runId));
        if (!run?.config) throw new Error("Memory Gate run config not found");
        return this.saveMemoryGateConfig({ ...run.config, projectId: run.projectId, projectTitle: run.projectTitle, rollbackFromRunId: run.id });
      } finally { db.close(); }
    },

    async listProjectConversationRefs(projectId) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(CONVERSATIONS, "readonly");
        const rows = await requestResult(tx.objectStore(CONVERSATIONS).index("projectId").getAll(IDBKeyRange.only(projectId)));
        return sortConversations(rows).map((row) => ({
          key: row.key, conversationId: row.conversationId, title: row.title, createdAt: row.createdAt, updatedAt: row.updatedAt,
          projectId: row.projectId, projectTitle: row.projectTitle, archived: Boolean(row.archived),
          currentEvidenceHash: row.currentEvidenceHash, currentEvidenceKey: row.currentEvidenceKey,
          messageCount: Number(row.messageCount || 0), activeMessageCount: Number(row.activeMessageCount || 0), sourceKinds: row.sourceKinds || [],
        }));
      } finally { db.close(); }
    },

    async getKnowledgeExportProfile(projectId) {
      const db = await openDatabase();
      try {
        const tx = db.transaction([KNOWLEDGE_EXPORT_PROFILES, KNOWLEDGE_EXPORT_PATHS], "readonly");
        const profile = await requestResult(tx.objectStore(KNOWLEDGE_EXPORT_PROFILES).get(projectId)) || null;
        const rows = await requestResult(tx.objectStore(KNOWLEDGE_EXPORT_PATHS).index("projectId").getAll(IDBKeyRange.only(projectId)));
        const pathMap = Object.fromEntries(rows.map((row) => [row.nodeId, row.record]));
        return { profile, pathMap };
      } finally { db.close(); }
    },

    async saveKnowledgeExportProfile(projectId, profile, pathMap) {
      const db = await openDatabase();
      try {
        const existingKeys = await keysForIndex(db, KNOWLEDGE_EXPORT_PATHS, "projectId", projectId);
        const tx = db.transaction([KNOWLEDGE_EXPORT_PROFILES, KNOWLEDGE_EXPORT_PATHS], "readwrite");
        tx.objectStore(KNOWLEDGE_EXPORT_PROFILES).put({ projectId, ...structuredClone(profile), updatedAt: profile.updatedAt || new Date().toISOString() });
        const pathStore = tx.objectStore(KNOWLEDGE_EXPORT_PATHS);
        for (const key of existingKeys) pathStore.delete(key);
        for (const [nodeId, record] of Object.entries(pathMap || {})) pathStore.put({ key: `${projectId}:${nodeId}`, projectId, nodeId, record: structuredClone(record) });
        await transactionDone(tx);
      } finally { db.close(); }
    },

    async saveKnowledgeExportRun(run) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(KNOWLEDGE_EXPORT_RUNS, "readwrite");
        tx.objectStore(KNOWLEDGE_EXPORT_RUNS).put(structuredClone(run));
        await transactionDone(tx);
        return run;
      } finally { db.close(); }
    },

    async getLatestKnowledgeExportRun(projectId) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(KNOWLEDGE_EXPORT_RUNS, "readonly");
        const rows = await requestResult(tx.objectStore(KNOWLEDGE_EXPORT_RUNS).index("projectId").getAll(IDBKeyRange.only(projectId)));
        return rows.sort((a,b)=>Date.parse(b.updatedAt||0)-Date.parse(a.updatedAt||0))[0] || null;
      } finally { db.close(); }
    },

    async getConversationDetail(conversationKey) {
      const db = await openDatabase();
      try {
        const tx = db.transaction([CONVERSATIONS, MESSAGES, EVIDENCE], "readonly");
        const conversation = await requestResult(tx.objectStore(CONVERSATIONS).get(conversationKey));
        if (!conversation) return null;
        const messages = await requestResult(tx.objectStore(MESSAGES).index("conversationKey").getAll(IDBKeyRange.only(conversationKey)));
        const evidence = await requestResult(tx.objectStore(EVIDENCE).get(conversation.currentEvidenceKey));
        const order = new Map((evidence?.canonical?.activePath || []).map((nodeId, index) => [nodeId, index]));
        messages.sort((a, b) => (order.get(a.nodeId) ?? 1e9) - (order.get(b.nodeId) ?? 1e9) || Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
        return { conversation, messages, evidence };
      } finally { db.close(); }
    },

    async clear() {
      const db = await openDatabase();
      try {
        // This action is exposed as “clear local library index”. It must never
        // erase independently governed Project State, approved Memory,
        // Memory Gate receipts, knowledge export profiles, or Capture records.
        const indexStores = [IMPORTS, CONVERSATIONS, MESSAGES, POSTINGS];
        const tx = db.transaction(indexStores, "readwrite");
        for (const name of indexStores) tx.objectStore(name).clear();
        await transactionDone(tx);
      } finally { db.close(); }
    },
  };
}

export function createMemoryLibraryStore() {
  const state = { imports: [], conversations: new Map(), evidence: new Map(), messages: new Map(), postings: new Map(), projectStates: new Map(), stateVersions: new Map(), proposals: new Map(), events: [], memoryProfiles: new Map(), memoryVersions: new Map(), memoryEvents: [], memoryGateConfigs: new Map(), memoryGateRuns: new Map(), knowledgeExportProfiles: new Map(), knowledgeExportPaths: new Map(), knowledgeExportRuns: new Map(), captureItems: new Map() };
  return {
    state,
    async upsertBundle(bundle) {
      const existing = state.conversations.get(bundle.conversation.key);
      const status = !existing ? "inserted" : existing.currentEvidenceHash === bundle.conversation.currentEvidenceHash ? "duplicate" : isIncomingStale(existing, bundle.conversation) ? "stale" : "updated";
      state.evidence.set(bundle.evidence.key, structuredClone(bundle.evidence));
      const merged = status === "stale" ? { ...existing, sourceKinds: mergeUnique(existing?.sourceKinds, bundle.conversation.sourceKinds), sourceFiles: mergeUnique(existing?.sourceFiles, bundle.conversation.sourceFiles) } : { ...(existing || {}), ...structuredClone(bundle.conversation), sourceKinds: mergeUnique(existing?.sourceKinds, bundle.conversation.sourceKinds), sourceFiles: mergeUnique(existing?.sourceFiles, bundle.conversation.sourceFiles) };
      state.conversations.set(bundle.conversation.key, merged);
      if (status !== "duplicate" && status !== "stale") {
        for (const [key, value] of state.messages) if (value.conversationKey === bundle.conversation.key) state.messages.delete(key);
        for (const [key, value] of state.postings) if (value.conversationKey === bundle.conversation.key) state.postings.delete(key);
        for (const row of bundle.messages) state.messages.set(row.key, structuredClone(row));
        for (const row of bundle.postings) state.postings.set(row.key, structuredClone(row));
      }
      return { status };
    },
    async putImport(record) { state.imports.push(structuredClone(record)); },
    async getStats() { const proposals=[...state.proposals.values()]; return { conversations: state.conversations.size, messages: state.messages.size, evidence: state.evidence.size, imports: state.imports.length, states: state.projectStates.size, versions: state.stateVersions.size, proposals: state.proposals.size, events: state.events.length, pendingProposals: proposals.filter((row)=>row.status==="pending").length, conflictedProposals: proposals.filter((row)=>row.status==="conflicted").length }; },
    async listProjects() { const map = new Map(); for (const row of state.conversations.values()) if (row.projectId) map.set(row.projectId, { id: row.projectId, title: row.projectTitle || row.projectId }); return [...map.values()]; },
    async listConversations(filters = {}) { return sortConversations([...state.conversations.values()].filter((conversation) => { const pseudo = { role: "unknown", createdAt: conversation.updatedAt }; return applyFilters(pseudo, conversation, filters); })).slice(0, filters.limit || 200); },
    async search(filters = {}) {
      const query = String(filters.query || "").trim();
      if (!query) return { query, results: [], conversations: await this.listConversations(filters) };
      const queryTokens = tokenizeText(query);
      const results = [...state.messages.values()].map((message) => ({ message, conversation: state.conversations.get(message.conversationKey), score: scoreSearchResult(message, query) }))
        .filter((item) => item.conversation && applyFilters(item.message, item.conversation, filters) && item.score > 0 && queryTokens.every((token) => item.message.normalizedText.includes(token)))
        .sort((a, b) => b.score - a.score).slice(0, filters.limit || 100);
      return { query, results, conversations: [] };
    },
    async exportAgentRecords(filters = {}) { const conversations = await this.listConversations({ ...filters, limit: Number.MAX_SAFE_INTEGER }); const keys = new Set(conversations.map((row) => row.key)); const evidenceKeys = new Set(conversations.map((row) => row.currentEvidenceKey)); const projectMap=new Map(conversations.filter((row)=>row.projectId).map((row)=>[row.projectId,row.projectTitle||row.projectId])); for(const row of state.captureItems.values()){if(!row.projectId)continue;if(filters.projectId&&filters.projectId!=="all"&&row.projectId!==filters.projectId)continue;projectMap.set(row.projectId,row.projectTitle||row.projectId);} if(filters.projectId&&filters.projectId!=="all"&&state.projectStates.has(filters.projectId)){const selected=state.projectStates.get(filters.projectId);projectMap.set(filters.projectId,selected.projectTitle||filters.projectId);} const states=[]; for(const [projectId,title] of projectMap) states.push(state.projectStates.get(projectId)||await emptyStateWithHash(projectId,title)); return { conversations: structuredClone(conversations), messages: [...state.messages.values()].filter((row) => keys.has(row.conversationKey)).map((row) => structuredClone(row)), evidence: [...state.evidence.values()].filter((row) => evidenceKeys.has(row.key)).map((row) => structuredClone(row)), states: structuredClone(states) }; },
    async listStateProjects() { const projects=new Map(); for(const row of state.conversations.values()) if(row.projectId) projects.set(row.projectId,{id:row.projectId,title:row.projectTitle||row.projectId}); for(const row of state.projectStates.values()) projects.set(row.projectId,{id:row.projectId,title:row.projectTitle||row.projectId}); for(const row of state.proposals.values()) projects.set(row.projectId,{id:row.projectId,title:row.projectTitle||row.projectId}); for(const row of state.captureItems.values()) if(row.projectId) projects.set(row.projectId,{id:row.projectId,title:row.projectTitle||row.projectId}); return [...projects.values()]; },
    async getProjectState(projectId, projectTitle="") { return structuredClone(state.projectStates.get(projectId)||await emptyStateWithHash(projectId,projectTitle)); },
    async listStateVersions(projectId) { return [...state.stateVersions.values()].filter((row)=>row.projectId===projectId).sort((a,b)=>b.version-a.version).map((row)=>structuredClone(row)); },
    async listStateEvents(projectId) { return state.events.filter((row)=>!projectId||row.projectId===projectId).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).map((row)=>structuredClone(row)); },
    async listStateProposals(filters={}) { return sortProposals([...state.proposals.values()].filter((row)=>(!filters.projectId||row.projectId===filters.projectId)&&(!filters.status||filters.status==="all"||row.status===filters.status))).map((row)=>structuredClone(row)); },
    async importStateProposal(value) { const proposal=normalizeStateProposal(value); if(state.proposals.has(proposal.id)) return {status:"duplicate",proposal:structuredClone(state.proposals.get(proposal.id))}; for(const uri of proposal.evidenceUris){const parsed=parseEvidenceUri(uri); const evidence=[...state.evidence.values()].find((row)=>row.conversationId===parsed?.conversationId&&row.evidenceHash===parsed?.evidenceHash); if(!evidence?.canonical?.nodes?.[parsed.nodeId]) throw new Error(`Proposal evidence validation failed: ${uri}`);} const current=state.projectStates.get(proposal.projectId)||await emptyStateWithHash(proposal.projectId,proposal.projectTitle); const base=proposal.baseVersion===0?await emptyStateWithHash(proposal.projectId,proposal.projectTitle):state.stateVersions.get(versionKey(proposal.projectId,proposal.baseVersion))?.snapshot||null; const conflicts=detectProposalConflicts({proposal,baseState:base,currentState:current}); const record={...proposal,status:conflicts.length?"conflicted":"pending",importedAt:new Date().toISOString(),evidenceChecks:proposal.evidenceUris.map((uri)=>({ok:true,uri})),conflicts,reviewedAt:null,reviewerNote:"",approvedVersion:null}; state.proposals.set(record.id,structuredClone(record)); state.events.push({id:auditId("proposal-imported"),projectId:record.projectId,proposalId:record.id,type:"proposal_imported",createdAt:record.importedAt,details:{status:record.status}}); return {status:record.status,proposal:structuredClone(record)}; },
    async getStateProposalReview(id) { const proposal=state.proposals.get(id); if(!proposal)return null; const current=state.projectStates.get(proposal.projectId)||await emptyStateWithHash(proposal.projectId,proposal.projectTitle); const base=proposal.baseVersion===0?await emptyStateWithHash(proposal.projectId,proposal.projectTitle):state.stateVersions.get(versionKey(proposal.projectId,proposal.baseVersion))?.snapshot||null; const conflicts=detectProposalConflicts({proposal,baseState:base,currentState:current}); let candidate=null,diff=[],previewError=null; try{candidate=applyStateProposal(current,proposal,proposal.createdAt||new Date().toISOString()); diff=diffProjectStates(current,candidate);}catch(error){previewError=error instanceof Error?error.message:String(error);} return {proposal:structuredClone(proposal),current:structuredClone(current),base:structuredClone(base),candidate:structuredClone(candidate),diff:structuredClone(diff),conflicts:structuredClone(conflicts),previewError}; },
    async approveStateProposal(id, reviewerNote="") { const proposal=state.proposals.get(id); if(!proposal)throw new Error(`Proposal not found: ${id}`); const current=state.projectStates.get(proposal.projectId)||await emptyStateWithHash(proposal.projectId,proposal.projectTitle); const base=proposal.baseVersion===0?await emptyStateWithHash(proposal.projectId,proposal.projectTitle):state.stateVersions.get(versionKey(proposal.projectId,proposal.baseVersion))?.snapshot||null; const conflicts=detectProposalConflicts({proposal,baseState:base,currentState:current}); if(conflicts.length)throw new Error(`Proposal has unresolved conflicts: ${conflicts.map((row)=>row.path).join(", ")}`); const reviewedAt=new Date().toISOString(); const next=await stateWithHash(applyStateProposal(current,proposal,reviewedAt)); if(current.stateVersion===0)state.stateVersions.set(versionKey(current.projectId,0),versionRecord(current,{action:"initial",createdAt:reviewedAt})); state.projectStates.set(next.projectId,structuredClone(next)); state.stateVersions.set(versionKey(next.projectId,next.stateVersion),versionRecord(next,{action:"approved",proposalId:proposal.id,reviewerNote,createdAt:reviewedAt})); const approved={...proposal,status:"approved",reviewedAt,reviewerNote:cleanReviewerNote(reviewerNote),approvedVersion:next.stateVersion,conflicts:[]}; state.proposals.set(id,approved); state.events.push({id:auditId("proposal-approved"),projectId:proposal.projectId,proposalId:id,type:"proposal_approved",createdAt:reviewedAt,details:{toVersion:next.stateVersion}}); return {proposal:structuredClone(approved),state:structuredClone(next),diff:diffProjectStates(current,next)}; },
    async rejectStateProposal(id, reviewerNote="") { const proposal=state.proposals.get(id); if(!proposal)throw new Error(`Proposal not found: ${id}`); if(proposal.status==="approved")throw new Error("Approved proposal cannot be rejected"); const rejected={...proposal,status:"rejected",reviewedAt:new Date().toISOString(),reviewerNote:cleanReviewerNote(reviewerNote)}; state.proposals.set(id,rejected); state.events.push({id:auditId("proposal-rejected"),projectId:proposal.projectId,proposalId:id,type:"proposal_rejected",createdAt:rejected.reviewedAt,details:{}}); return structuredClone(rejected); },
    async rollbackProjectState(projectId,targetVersion,reviewerNote="") { const current=state.projectStates.get(projectId)||await emptyStateWithHash(projectId,projectId); const target=targetVersion===0?await emptyStateWithHash(projectId,current.projectTitle):state.stateVersions.get(versionKey(projectId,targetVersion))?.snapshot; if(!target)throw new Error(`State version not found: v${targetVersion}`); const createdAt=new Date().toISOString(); const restored=await stateWithHash({...structuredClone(target),stateVersion:current.stateVersion+1,updatedAt:createdAt,lastProposalId:null}); state.projectStates.set(projectId,restored); state.stateVersions.set(versionKey(projectId,restored.stateVersion),versionRecord(restored,{action:"rollback",createdAt,rollbackFromVersion:targetVersion,reviewerNote})); state.events.push({id:auditId("state-rollback"),projectId,proposalId:null,type:"state_rollback",createdAt,details:{restoredFromVersion:targetVersion,toVersion:restored.stateVersion}}); return {state:structuredClone(restored),diff:diffProjectStates(current,restored)}; },
    async getApprovedMemory(projectId) { return structuredClone(state.memoryProfiles.get(projectId) || null); },
    async listMemoryVersions(projectId) { return [...state.memoryVersions.values()].filter((row) => row.projectId === projectId).sort((a,b)=>b.version-a.version).map((row)=>structuredClone(row)); },
    async approveMemoryPackage(candidate, reviewerNote = "") {
      if (!candidate?.projectId || !candidate?.core?.markdown || !candidate?.project?.markdown) throw new Error("Memory candidate is incomplete");
      const current = state.memoryProfiles.get(candidate.projectId);
      if (current?.hash === candidate.hash) return structuredClone(current);
      const currentState = state.projectStates.get(candidate.projectId) || await emptyStateWithHash(candidate.projectId, candidate.projectTitle);
      if (Number(currentState.stateVersion || 0) !== Number(candidate.sourceStateVersion || 0) || (currentState.stateHash || null) !== (candidate.sourceStateHash || null)) throw new Error("Project state changed after memory generation. Regenerate and review again.");
      const approvedAt = new Date().toISOString();
      const version = Number(current?.version || 0) + 1;
      const record = { format:"context-vault-approved-memory", schemaVersion:1, projectId:candidate.projectId, projectTitle:candidate.projectTitle||candidate.projectId, version, hash:candidate.hash, approvedAt, reviewerNote:cleanReviewerNote(reviewerNote), sourceStateVersion:candidate.sourceStateVersion||0, sourceStateHash:candidate.sourceStateHash||null, core:structuredClone(candidate.core), project:structuredClone(candidate.project) };
      state.memoryProfiles.set(record.projectId, structuredClone(record));
      state.memoryVersions.set(`${record.projectId}:v${version}`, { key:`${record.projectId}:v${version}`, ...structuredClone(record) });
      state.memoryEvents.push({ id:auditId("memory-approved"), projectId:record.projectId, type:"memory_approved", createdAt:approvedAt, details:{version,hash:record.hash} });
      return structuredClone(record);
    },
    async getMemoryGateConfig(projectId) { return structuredClone(state.memoryGateConfigs.get(projectId)||null); },
    async saveMemoryGateConfig(value) { const current=state.memoryGateConfigs.get(value.projectId); const record={format:"kv-archive-memory-gate-config",schemaVersion:1,projectId:value.projectId,projectTitle:value.projectTitle||value.projectId,version:Number(current?.version||0)+1,policy:["safe","balanced","broad"].includes(value.policy)?value.policy:"balanced",target:["internal","external"].includes(value.target)?value.target:"internal",tokenBudget:Math.max(128,Math.floor(Number(value.tokenBudget||2048))),overrides:structuredClone(value.overrides||{}),rollbackFromRunId:value.rollbackFromRunId||null,updatedAt:new Date().toISOString()}; record.hash=await sha256Hex(record); state.memoryGateConfigs.set(record.projectId,structuredClone(record)); return structuredClone(record); },
    async saveMemoryGateRun(value) { const createdAt=value.createdAt||new Date().toISOString(); const id=value.id||`memory-gate-run:${value.projectId}:${createdAt}:${Math.random().toString(36).slice(2)}`; if(state.memoryGateRuns.has(id))throw new Error(`Memory Gate run receipt already exists: ${id}`); const record={format:"kv-archive-memory-gate-run",schemaVersion:1,...structuredClone(value),id,createdAt}; record.hash=await sha256Hex({projectId:record.projectId,createdAt,config:record.config,report:record.report}); state.memoryGateRuns.set(id,structuredClone(record)); return structuredClone(record); },
    async listMemoryGateRuns(projectId) { return [...state.memoryGateRuns.values()].filter((row)=>row.projectId===projectId).sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0)).map((row)=>structuredClone(row)); },
    async restoreMemoryGateConfigFromRun(runId) { const run=state.memoryGateRuns.get(runId); if(!run?.config)throw new Error("Memory Gate run config not found"); return this.saveMemoryGateConfig({...run.config,projectId:run.projectId,projectTitle:run.projectTitle,rollbackFromRunId:run.id}); },
    async listProjectConversationRefs(projectId) { return [...state.conversations.values()].filter((row)=>row.projectId===projectId).sort((a,b)=>Date.parse(b.updatedAt||0)-Date.parse(a.updatedAt||0)).map((row)=>({ key:row.key,conversationId:row.conversationId,title:row.title,createdAt:row.createdAt,updatedAt:row.updatedAt,projectId:row.projectId,projectTitle:row.projectTitle,archived:Boolean(row.archived),currentEvidenceHash:row.currentEvidenceHash,currentEvidenceKey:row.currentEvidenceKey,messageCount:Number(row.messageCount||0),activeMessageCount:Number(row.activeMessageCount||0),sourceKinds:row.sourceKinds||[] })); },
    async getKnowledgeExportProfile(projectId) { const profile=state.knowledgeExportProfiles.get(projectId)||null; const pathMap=Object.fromEntries([...state.knowledgeExportPaths.entries()].filter(([key])=>key.startsWith(`${projectId}:`)).map(([,row])=>[row.nodeId,row.record])); return {profile:structuredClone(profile),pathMap:structuredClone(pathMap)}; },
    async saveKnowledgeExportProfile(projectId,profile,pathMap) { state.knowledgeExportProfiles.set(projectId,structuredClone({projectId,...profile,updatedAt:profile.updatedAt||new Date().toISOString()})); for(const key of [...state.knowledgeExportPaths.keys()])if(key.startsWith(`${projectId}:`))state.knowledgeExportPaths.delete(key); for(const [nodeId,record] of Object.entries(pathMap||{}))state.knowledgeExportPaths.set(`${projectId}:${nodeId}`,{nodeId,record:structuredClone(record)}); },
    async saveKnowledgeExportRun(run) { state.knowledgeExportRuns.set(run.id,structuredClone(run)); return structuredClone(run); },
    async getLatestKnowledgeExportRun(projectId) { return [...state.knowledgeExportRuns.values()].filter((row)=>row.projectId===projectId).sort((a,b)=>Date.parse(b.updatedAt||0)-Date.parse(a.updatedAt||0)).map((row)=>structuredClone(row))[0]||null; },
    async getConversationDetail(key) { const conversation = state.conversations.get(key); if (!conversation) return null; const evidence = state.evidence.get(conversation.currentEvidenceKey); const messages = [...state.messages.values()].filter((item) => item.conversationKey === key); return { conversation, evidence, messages }; },
    async clear() {
      state.imports.length = 0;
      state.conversations.clear();
      state.messages.clear();
      state.postings.clear();
    },
  };
}
