import { createStoredZip } from "./zip.js";
import { sha256Hex, stableStringify } from "./vault-index.js";

const encoder = new TextEncoder();
const jsonLine = (value) => `${JSON.stringify(value)}\n`;
const byKey = (a, b) => String(a.key || "").localeCompare(String(b.key || ""));
const byId = (a, b) => String(a.id || "").localeCompare(String(b.id || ""));

function recordsAsJsonl(rows) { return rows.map(jsonLine).join(""); }

export async function buildAgentBundle(records, options = {}) {
  const conversations = [...(records.conversations || [])].sort(byKey);
  const conversationKeys = new Set(conversations.map((row) => row.key));
  const messages = [...(records.messages || [])].filter((row) => conversationKeys.has(row.conversationKey)).sort((a, b) => a.conversationKey.localeCompare(b.conversationKey) || String(a.nodeId).localeCompare(String(b.nodeId)));
  const currentEvidenceKeys = new Set(conversations.map((row) => row.currentEvidenceKey).filter(Boolean));
  const evidence = [...(records.evidence || [])].filter((row) => currentEvidenceKeys.has(row.key)).sort(byKey);
  const states = [...(records.states || [])].sort((a, b) => String(a.projectId || "").localeCompare(String(b.projectId || "")));
  const contentObjects = [...(records.contentObjects || [])].sort(byId);
  const contentIds = new Set(contentObjects.map((row) => row.id));
  const contentVersions = [...(records.contentVersions || [])].filter((row) => contentIds.has(row.objectId)).sort((a,b)=>String(a.objectId).localeCompare(String(b.objectId))||Number(a.revision)-Number(b.revision));
  const contentRelations = [...(records.contentRelations || [])].filter((row) => contentIds.has(row.fromId) && contentIds.has(row.toId)).sort(byId);
  const contentOperations = [...(records.contentOperations || [])].filter((row) => contentIds.has(row.objectId)).sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||""))||byId(a,b));
  const contentPromotions = [...(records.contentPromotions || [])].filter((row) => contentIds.has(row.sourceObjectId)).sort(byId);
  const fingerprint = await sha256Hex(stableStringify({
    conversations: conversations.map((row) => [row.key, row.currentEvidenceHash]),
    messages: messages.map((row) => [row.key, row.evidenceHash]),
    evidence: evidence.map((row) => row.evidenceHash),
    states: states.map((row) => [row.projectId, row.stateVersion, row.stateHash]),
    contentObjects: contentObjects.map((row) => [row.id,row.revision,row.contentHash,row.status]),
    contentVersions: contentVersions.map((row) => [row.key,row.objectId,row.revision,row.snapshotHash]),
    contentRelations: contentRelations.map((row) => [row.id,row.fromId,row.relation,row.toId]),
    contentOperations: contentOperations.map((row) => [row.id,row.objectId,row.type,row.afterHash]),
    contentPromotions: contentPromotions.map((row) => [row.id,row.sourceObjectId,row.targetKind,row.status]),
    filters: options.filters || {},
  }));
  const manifest = {
    format: "context-vault-agent-bundle",
    version: 3,
    sourceApp: "KV Archive",
    sourceAppVersion: options.sourceAppVersion || "0.16.11",
    bundleId: `cvb-${fingerprint.slice(0, 24)}`,
    createdAt: new Date().toISOString(),
    readOnly: true,
    approvedStateReadOnly: true,
    proposalWorkflow: "review-required",
    containsSensitiveConversationData: true,
    includesBinaryAttachments: false,
    filters: options.filters || {},
    counts: { conversations: conversations.length, messages: messages.length, evidence: evidence.length, projectStates: states.length, contentObjects: contentObjects.length, contentVersions: contentVersions.length, contentRelations: contentRelations.length, contentOperations: contentOperations.length, contentPromotions: contentPromotions.length },
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
  const readme = `# KV Archive Agent Bundle\n\nBundle ID: ${manifest.bundleId}\n\nThis package contains local conversation evidence for the read-only KV Archive Agent Bridge. It contains text and raw conversation evidence, but no downloaded binary attachments. Keep it private.\n\n## Files\n\n- manifest.json\n- data/conversations.jsonl\n- data/messages.jsonl\n- data/evidence.jsonl\n- configs/*.json\n\n## Start the bridge\n\nUse the separate KV Archive Agent Bridge package:\n\n\`\`\`bash\nnode dist/agent/index.js serve --bundle /absolute/path/to/this-bundle.zip\n\`\`\`\n`;
  const config = (kind) => JSON.stringify(kind === "vscode" ? {
    servers: { kvArchive: { type: "stdio", command: "node", args: ["/ABSOLUTE/PATH/kv-archive-agent-bridge/dist/agent/index.js", "serve", "--bundle", "/ABSOLUTE/PATH/KV-Archive-Agent-Bundle.zip"] } },
  } : {
    mcpServers: { kvArchive: { command: "node", args: ["/ABSOLUTE/PATH/kv-archive-agent-bridge/dist/agent/index.js", "serve", "--bundle", "/ABSOLUTE/PATH/KV-Archive-Agent-Bundle.zip"] } },
  }, null, 2);
  const codexConfig = `[mcp_servers.kv_archive]
command = "node"
args = ["/ABSOLUTE/PATH/kv-archive-agent-bridge/dist/agent/index.js", "serve", "--bundle", "/ABSOLUTE/PATH/KV-Archive-Agent-Bundle.zip"]
startup_timeout_ms = 20000
`;
  const entries = [
    { name: "manifest.json", data: JSON.stringify(manifest, null, 2) + "\n" },
    { name: "README.md", data: readme },
    { name: "data/conversations.jsonl", data: recordsAsJsonl(conversations) },
    { name: "data/messages.jsonl", data: recordsAsJsonl(messages) },
    { name: "data/evidence.jsonl", data: recordsAsJsonl(evidence) },
    { name: "data/project-states.jsonl", data: recordsAsJsonl(states) },
    { name: "data/content-objects.jsonl", data: recordsAsJsonl(contentObjects) },
    { name: "data/content-versions.jsonl", data: recordsAsJsonl(contentVersions) },
    { name: "data/content-relations.jsonl", data: recordsAsJsonl(contentRelations) },
    { name: "data/content-operations.jsonl", data: recordsAsJsonl(contentOperations) },
    { name: "data/content-promotions.jsonl", data: recordsAsJsonl(contentPromotions) },
    { name: "configs/claude-cursor.json", data: config("generic") + "\n" },
    { name: "configs/codex-config.toml", data: codexConfig },
    { name: "configs/vscode-mcp.json", data: config("vscode") + "\n" },
    { name: "MCP_TOOLS.md", data: "# KV Archive tools\n\nRead-only evidence/state tools:\n\n- vault_stats\n- list_projects\n- search_messages\n- read_conversation\n- get_project_snapshot\n- get_source_evidence\n- build_context_pack\n\nControlled proposal tool:\n\n- create_state_proposal (writes a proposal JSON only; never mutates approved state)\n" },
    { name: "CONTINUITY_BENCHMARK.md", data: "# Continuity Benchmark\n\nUse KV Archive Agent Bridge v0.16.7 or later to create a private answer key and a public handoff challenge. Give the receiving Agent only PROMPT.md, benchmark-challenge.json, and response-template.json. Keep benchmark-answer-key.json private, then score the returned JSON with benchmark-score. A verified PASS requires at least 85/100 and no critical identity, unsupported-record, or invalid-evidence errors.\n" },
  ];
  const estimatedBytes = entries.reduce((sum, entry) => sum + (typeof entry.data === "string" ? encoder.encode(entry.data).length : entry.data.length), 0);
  if (estimatedBytes > (options.maxBytes || 536_870_912)) throw new Error("Agent 接力包超过 512 MB。请先按 Project、来源或日期缩小筛选范围后再导出。");
  return { manifest, bytes: createStoredZip(entries), filename: `KV-Archive-Agent-Bundle-${manifest.bundleId}.zip`, entries: entries.map((entry) => entry.name), byteLength: estimatedBytes };
}
