import { createHash } from "node:crypto";
import { createStoredZip } from "./zip-writer.js";
import { BRIDGE_VERSION } from "./version.js";

const encoder = new TextEncoder();
const jsonLine = (value) => `${JSON.stringify(value)}\n`;
const byKey = (a, b) => String(a.key || "").localeCompare(String(b.key || ""));
const byId = (a, b) => String(a.id || "").localeCompare(String(b.id || ""));

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function sha256Hex(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return createHash("sha256").update(bytes).digest("hex");
}

function recordsAsJsonl(rows) { return rows.map(jsonLine).join(""); }

export function selectProjectRecords(repository, projectIdentifier) {
  const snapshot = repository.projectSnapshot(projectIdentifier, { conversationLimit: 500, contentLimit: 1000 });
  const projectId = snapshot.project.id;
  const projectTitle = snapshot.project.title;
  const conversations = [...repository.conversations.values()].filter((row) => row.projectId === projectId).sort(byKey);
  const conversationKeys = new Set(conversations.map((row) => row.key));
  const messages = repository.messages.filter((row) => conversationKeys.has(row.conversationKey)).sort((a, b) => String(a.conversationKey).localeCompare(String(b.conversationKey)) || String(a.nodeId).localeCompare(String(b.nodeId)));
  const evidenceKeys = new Set(conversations.map((row) => row.currentEvidenceKey).filter(Boolean));
  const evidence = [...repository.evidence.values()].filter((row) => evidenceKeys.has(row.key)).sort(byKey);
  const state = repository.projectState(projectId);
  if (!state) throw new Error(`Approved Project State not found: ${projectIdentifier}`);
  const states = [state];
  const contentObjects = [...repository.contentObjects.values()].filter((row) => row.projectId === projectId && row.status !== "trashed").sort(byId);
  const contentIds = new Set(contentObjects.map((row) => row.id));
  const contentVersions = repository.contentVersions.filter((row) => contentIds.has(row.objectId)).sort((a, b) => String(a.objectId).localeCompare(String(b.objectId)) || Number(a.revision) - Number(b.revision));
  const contentRelations = repository.contentRelations.filter((row) => contentIds.has(row.fromId) && contentIds.has(row.toId)).sort(byId);
  const contentOperations = repository.contentOperations.filter((row) => contentIds.has(row.objectId)).sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || byId(a, b));
  const contentPromotions = repository.contentPromotions.filter((row) => contentIds.has(row.sourceObjectId)).sort(byId);
  return { project: { id: projectId, title: projectTitle }, conversations, messages, evidence, states, contentObjects, contentVersions, contentRelations, contentOperations, contentPromotions };
}

export function buildScopedAgentBundle(repository, projectIdentifier, options = {}) {
  const records = selectProjectRecords(repository, projectIdentifier);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const fingerprint = sha256Hex(stableStringify({
    project: records.project,
    sourceBundleId: repository.manifest.bundleId,
    conversations: records.conversations.map((row) => [row.key, row.currentEvidenceHash]),
    messages: records.messages.map((row) => [row.key, row.evidenceHash]),
    evidence: records.evidence.map((row) => [row.key, row.evidenceHash]),
    states: records.states.map((row) => [row.projectId, row.stateVersion, row.stateHash]),
    contentObjects: records.contentObjects.map((row) => [row.id, row.revision, row.contentHash, row.status]),
    contentVersions: records.contentVersions.map((row) => [row.key, row.objectId, row.revision, row.snapshotHash]),
    contentRelations: records.contentRelations.map((row) => [row.id, row.fromId, row.relation, row.toId]),
    contentOperations: records.contentOperations.map((row) => [row.id, row.objectId, row.type, row.afterHash]),
    contentPromotions: records.contentPromotions.map((row) => [row.id, row.sourceObjectId, row.targetKind, row.status]),
  }));
  const manifest = {
    format: "context-vault-agent-bundle",
    version: 3,
    sourceApp: "KV Archive",
    sourceAppVersion: BRIDGE_VERSION,
    bundleId: `cvb-project-${fingerprint.slice(0, 24)}`,
    createdAt: generatedAt,
    readOnly: true,
    approvedStateReadOnly: true,
    proposalWorkflow: "review-required",
    containsSensitiveConversationData: true,
    includesBinaryAttachments: false,
    filters: { projectId: records.project.id, verifiedHandoff: true },
    counts: {
      conversations: records.conversations.length,
      messages: records.messages.length,
      evidence: records.evidence.length,
      projectStates: records.states.length,
      contentObjects: records.contentObjects.length,
      contentVersions: records.contentVersions.length,
      contentRelations: records.contentRelations.length,
      contentOperations: records.contentOperations.length,
      contentPromotions: records.contentPromotions.length,
    },
    tokenBudgets: [2048, 8192, 32768],
    continuityBenchmarkVersion: 1,
    files: {
      conversations: "data/conversations.jsonl",
      messages: "data/messages.jsonl",
      evidence: "data/evidence.jsonl",
      projectStates: "data/project-states.jsonl",
      contentObjects: "data/content-objects.jsonl",
      contentVersions: "data/content-versions.jsonl",
      contentRelations: "data/content-relations.jsonl",
      contentOperations: "data/content-operations.jsonl",
      contentPromotions: "data/content-promotions.jsonl",
    },
  };
  const entries = [
    { name: "manifest.json", data: `${JSON.stringify(manifest, null, 2)}\n` },
    { name: "README.md", data: `# KV Archive Project-scoped Agent Bundle\n\nProject: ${records.project.title} (${records.project.id})\n\nThis read-only bundle was generated for a Verified Handoff. It contains only the selected Project. Approved state cannot be mutated; changes must be emitted as review-required proposals.\n` },
    { name: "data/conversations.jsonl", data: recordsAsJsonl(records.conversations) },
    { name: "data/messages.jsonl", data: recordsAsJsonl(records.messages) },
    { name: "data/evidence.jsonl", data: recordsAsJsonl(records.evidence) },
    { name: "data/project-states.jsonl", data: recordsAsJsonl(records.states) },
    { name: "data/content-objects.jsonl", data: recordsAsJsonl(records.contentObjects) },
    { name: "data/content-versions.jsonl", data: recordsAsJsonl(records.contentVersions) },
    { name: "data/content-relations.jsonl", data: recordsAsJsonl(records.contentRelations) },
    { name: "data/content-operations.jsonl", data: recordsAsJsonl(records.contentOperations) },
    { name: "data/content-promotions.jsonl", data: recordsAsJsonl(records.contentPromotions) },
  ];
  const bytes = createStoredZip(entries, new Date(generatedAt));
  return { records, manifest, bytes, sha256: sha256Hex(bytes), entries: entries.map((entry) => entry.name) };
}
