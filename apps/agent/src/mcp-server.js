import readline from "node:readline";
import { resolve } from "node:path";
import { openAgentRepository } from "./agent-core.js";
import { writeStateProposal } from "./proposal-core.js";
import { BRIDGE_VERSION } from "./version.js";

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const readOnlyAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const proposalAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const tools = [
  { name: "vault_stats", description: "Return ContextVault bundle statistics, approved-state coverage, and supported token budgets.", inputSchema: { type: "object", additionalProperties: false, properties: {} }, annotations: readOnlyAnnotations },
  { name: "list_projects", description: "List projects available in the local evidence bundle, including approved-state version metadata.", inputSchema: { type: "object", additionalProperties: false, properties: {} }, annotations: readOnlyAnnotations },
  { name: "search_messages", description: "Search indexed messages and return evidence-backed excerpts with provenance.", inputSchema: { type: "object", additionalProperties: false, properties: { query: { type: "string" }, projectId: { type: "string" }, projectTitle: { type: "string" }, roles: { type: "array", items: { enum: ["user","assistant","system","tool","unknown"] } }, sourceKind: { type: "string" }, activePathOnly: { type: "boolean", default: true }, limit: { type: "integer", minimum: 1, maximum: 200, default: 20 }, includeFullText: { type: "boolean", default: false } }, required: ["query"] }, annotations: readOnlyAnnotations },
  { name: "list_content_objects", description: "List editable notes, flashes, excerpts, files, and other unified content objects without exposing raw immutable evidence payloads.", inputSchema: { type: "object", additionalProperties: false, properties: { projectId: { type: "string" }, projectTitle: { type: "string" }, kind: { enum: ["all","note","flash","web_excerpt","ai_excerpt","conversation","image","file"] }, status: { enum: ["all","active","archived","trashed"] }, includeTrashed: { type: "boolean", default: false }, limit: { type: "integer", minimum: 1, maximum: 1000, default: 100 } } }, annotations: readOnlyAnnotations },
  { name: "search_content", description: "Search unified content objects and return bounded excerpts with stable content evidence URIs.", inputSchema: { type: "object", additionalProperties: false, properties: { query: { type: "string" }, projectId: { type: "string" }, projectTitle: { type: "string" }, kind: { enum: ["all","note","flash","web_excerpt","ai_excerpt","conversation","image","file"] }, status: { enum: ["all","active","archived","trashed"] }, limit: { type: "integer", minimum: 1, maximum: 200, default: 20 }, includeFullText: { type: "boolean", default: false } }, required: ["query"] }, annotations: readOnlyAnnotations },
  { name: "read_content_object", description: "Read one unified content object, its typed relations, immutable operations, and review-required promotions.", inputSchema: { type: "object", additionalProperties: false, properties: { objectId: { type: "string" }, maxChars: { type: "integer", minimum: 200, maximum: 1000000, default: 100000 }, includeOperations: { type: "boolean", default: true }, includePromotions: { type: "boolean", default: true } }, required: ["objectId"] }, annotations: readOnlyAnnotations },
  { name: "read_conversation", description: "Read one conversation by conversation ID or ContextVault key. Defaults to the active branch.", inputSchema: { type: "object", additionalProperties: false, properties: { conversationId: { type: "string" }, activePathOnly: { type: "boolean", default: true }, roles: { type: "array", items: { type: "string" } }, maxMessages: { type: "integer", minimum: 1, maximum: 2000, default: 200 }, maxCharsPerMessage: { type: "integer", minimum: 200, maximum: 100000, default: 12000 } }, required: ["conversationId"] }, annotations: readOnlyAnnotations },
  { name: "get_project_snapshot", description: "Return project inventory, approved project state, and recent conversation metadata.", inputSchema: { type: "object", additionalProperties: false, properties: { project: { type: "string" }, conversationLimit: { type: "integer", minimum: 1, maximum: 500, default: 50 } }, required: ["project"] }, annotations: readOnlyAnnotations },
  { name: "get_source_evidence", description: "Return source metadata, canonical evidence, or bounded raw evidence for a conversation.", inputSchema: { type: "object", additionalProperties: false, properties: { identifier: { type: "string" }, mode: { enum: ["metadata","canonical","raw"], default: "metadata" }, maxChars: { type: "integer", minimum: 1000, maximum: 2000000, default: 100000 } }, required: ["identifier"] }, annotations: readOnlyAnnotations },
  { name: "run_memory_gate", description: "Evaluate approved Project State through deterministic INCLUDE, EXCLUDE, and REVIEW rules before handoff.", inputSchema: { type: "object", additionalProperties: false, properties: { project: { type: "string" }, policy: { enum: ["safe","balanced","broad"], default: "balanced" }, target: { enum: ["internal","external"], default: "internal" }, tokenBudget: { type: "integer", minimum: 128, maximum: 32768, default: 2048 } }, required: ["project"] }, annotations: readOnlyAnnotations },
  { name: "build_context_pack", description: "Build a deterministic evidence-backed Markdown Context Pack within a 2K, 8K, or 32K estimated token budget, optionally gated by approved memory rules.", inputSchema: { type: "object", additionalProperties: false, properties: { query: { type: "string" }, projectId: { type: "string" }, projectTitle: { type: "string" }, conversationIds: { type: "array", items: { type: "string" } }, roles: { type: "array", items: { type: "string" } }, sourceKind: { type: "string" }, activePathOnly: { type: "boolean", default: true }, budgetTokens: { enum: [2048,8192,32768], default: 8192 }, maxExcerptsPerConversation: { type: "integer", minimum: 1, maximum: 10, default: 3 }, memoryGatePolicy: { enum: ["safe","balanced","broad"] }, memoryGateBudgetTokens: { type: "integer", minimum: 128, maximum: 32768 }, memoryGateTarget: { enum: ["internal","external"], default: "internal" } } }, annotations: readOnlyAnnotations },
  {
    name: "create_state_proposal",
    description: "Create a reviewable ContextVault state proposal JSON in the local proposal outbox. This never changes approved project state; the user must import and approve it in ContextVault.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["project", "kind", "title", "evidenceUris", "change"],
      properties: {
        project: { type: "string", description: "Project ID or title from list_projects." },
        kind: { enum: ["project_status", "decision", "task", "supersession"] },
        title: { type: "string", minLength: 1, maxLength: 500 },
        rationale: { type: "string", maxLength: 20000 },
        expectedImpact: { type: "string", maxLength: 20000 },
        riskLevel: { enum: ["low", "medium", "high"], default: "medium" },
        evidenceUris: { type: "array", minItems: 1, maxItems: 500, items: { type: "string" } },
        change: { type: "object" },
        agentName: { type: "string" },
        client: { type: "string" },
      },
    },
    annotations: proposalAnnotations,
  },
];

function jsonRpcResult(id, result) { return { jsonrpc: "2.0", id, result }; }
function jsonRpcError(id, code, message, data) { return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } }; }
function toolResult(value) { const text = typeof value === "string" ? value : JSON.stringify(value, null, 2); return { content: [{ type: "text", text }], structuredContent: typeof value === "string" ? { text: value } : value }; }

function validateArguments(name, args) {
  const object = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  if (name === "search_messages" && typeof object.query !== "string") throw new Error("query is required");
  if (name === "list_content_objects" && object.limit !== undefined && (!Number.isInteger(Number(object.limit)) || Number(object.limit) < 1)) throw new Error("limit is invalid");
  if (name === "search_content" && typeof object.query !== "string") throw new Error("query is required");
  if (name === "read_content_object" && typeof object.objectId !== "string") throw new Error("objectId is required");
  if (name === "read_conversation" && typeof object.conversationId !== "string") throw new Error("conversationId is required");
  if (name === "get_project_snapshot" && typeof object.project !== "string") throw new Error("project is required");
  if (name === "get_source_evidence" && typeof object.identifier !== "string") throw new Error("identifier is required");
  if (name === "run_memory_gate" && typeof object.project !== "string") throw new Error("project is required");
  if (name === "build_context_pack" && !object.query && !object.projectId && !object.projectTitle && !object.conversationIds?.length) throw new Error("Provide query, project, or conversationIds");
  if (name === "build_context_pack" && object.memoryGatePolicy && !object.projectId && !object.projectTitle) throw new Error("Memory Gate requires projectId or projectTitle");
  if (name === "build_context_pack" && object.budgetTokens !== undefined && ![2048, 8192, 32768].includes(Number(object.budgetTokens))) throw new Error("budgetTokens must be 2048, 8192, or 32768");
  if (name === "create_state_proposal") {
    if (typeof object.project !== "string") throw new Error("project is required");
    if (!["project_status", "decision", "task", "supersession"].includes(object.kind)) throw new Error("kind is invalid");
    if (typeof object.title !== "string" || !object.title.trim()) throw new Error("title is required");
    if (!Array.isArray(object.evidenceUris) || object.evidenceUris.length === 0) throw new Error("evidenceUris is required");
    if (!object.change || typeof object.change !== "object" || Array.isArray(object.change)) throw new Error("change object is required");
  }
  return object;
}

export async function createMcpHandler(bundlePath, options = {}) {
  const repository = await openAgentRepository(bundlePath);
  const proposalDir = resolve(options.proposalDir || "./context-vault-proposals");
  return async function handle(message) {
    if (!message || message.jsonrpc !== "2.0") return message?.id === undefined ? null : jsonRpcError(message.id, -32600, "Invalid Request");
    if (message.id === undefined) return null;
    try {
      if (message.method === "initialize") {
        const requested = message.params?.protocolVersion;
        const protocolVersion = PROTOCOLS.includes(requested) ? requested : PROTOCOLS[0];
        return jsonRpcResult(message.id, { protocolVersion, capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } }, serverInfo: { name: "context-vault", version: BRIDGE_VERSION }, instructions: "Evidence and approved state are read-only. The only write-capable tool creates a proposal JSON in a local outbox; it cannot approve or mutate project state. Cite ContextVault evidence URIs for every proposal." });
      }
      if (message.method === "ping") return jsonRpcResult(message.id, {});
      if (message.method === "tools/list") return jsonRpcResult(message.id, { tools });
      if (message.method === "resources/list") return jsonRpcResult(message.id, { resources: [
        { uri: "contextvault://manifest", name: "ContextVault Agent Bundle manifest", mimeType: "application/json" },
        { uri: "contextvault://projects", name: "ContextVault projects and approved states", mimeType: "application/json" },
      ] });
      if (message.method === "resources/read") {
        const uri = message.params?.uri;
        if (uri === "contextvault://manifest") return jsonRpcResult(message.id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(repository.manifest, null, 2) }] });
        if (uri === "contextvault://projects") return jsonRpcResult(message.id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(repository.listProjects(), null, 2) }] });
        return jsonRpcError(message.id, -32002, "Resource not found");
      }
      if (message.method === "tools/call") {
        const name = message.params?.name;
        const args = validateArguments(name, message.params?.arguments);
        let value;
        if (name === "vault_stats") value = repository.stats();
        else if (name === "list_projects") value = repository.listProjects();
        else if (name === "search_messages") value = repository.searchMessages(args);
        else if (name === "list_content_objects") value = repository.listContent(args);
        else if (name === "search_content") value = repository.searchContent(args);
        else if (name === "read_content_object") value = repository.readContent(args.objectId,args);
        else if (name === "read_conversation") value = repository.readConversation(args.conversationId, args);
        else if (name === "get_project_snapshot") value = repository.projectSnapshot(args.project, args);
        else if (name === "get_source_evidence") value = repository.sourceEvidence(args.identifier, args);
        else if (name === "run_memory_gate") value = repository.runMemoryGate({ project: args.project, policy: args.policy, target: args.target, tokenBudget: args.tokenBudget });
        else if (name === "build_context_pack") value = repository.buildContextPack(args);
        else if (name === "create_state_proposal") {
          const result = await writeStateProposal(repository, { ...args, projectId: args.project }, { outputDir: proposalDir, client: options.client || "mcp" });
          value = { proposalPath: result.path, proposal: result.proposal, approvalRequired: true, approvedStateMutated: false };
        } else return jsonRpcError(message.id, -32601, `Unknown ContextVault tool: ${name}`);
        return jsonRpcResult(message.id, toolResult(value));
      }
      return jsonRpcError(message.id, -32601, `Method not found: ${message.method}`);
    } catch (error) {
      return jsonRpcResult(message.id, { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true });
    }
  };
}

export async function serveMcpStdio(bundlePath, options = {}, streams = { input: process.stdin, output: process.stdout, error: process.stderr }) {
  const handle = await createMcpHandler(bundlePath, options);
  const rl = readline.createInterface({ input: streams.input, crlfDelay: Infinity });
  streams.error.write(`KV Archive MCP controlled-proposal server loaded: ${bundlePath}\nProposal outbox: ${resolve(options.proposalDir || "./context-vault-proposals")}\n`);
  for await (const line of rl) {
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); }
    catch { streams.output.write(`${JSON.stringify(jsonRpcError(null, -32700, "Parse error"))}\n`); continue; }
    const response = await handle(message);
    if (response) streams.output.write(`${JSON.stringify(response)}\n`);
  }
}
