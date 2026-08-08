import type {
  CanonicalContentPart,
  CanonicalConversation,
  CanonicalMessageNode,
} from "../../domain/src/index.js";
import type {
  ContentRelation as UnifiedContentRelation,
  UnifiedContentObject,
} from "../../content-contract/src/index.js";

export const KNOWLEDGE_GRAPH_FORMAT = "context-vault-knowledge-graph" as const;
export const KNOWLEDGE_GRAPH_SCHEMA_VERSION = 1 as const;

export type KnowledgeNodeKind =
  | "project"
  | "conversation"
  | "decision"
  | "task"
  | "memory"
  | "evidence"
  | "asset"
  | "content";

export type KnowledgeRelation =
  | "belongs_to"
  | "supports"
  | "derived_from"
  | "depends_on"
  | "supersedes"
  | "summarizes"
  | "references"
  | "related_to"
  | "contains"
  | "promoted_to";

export type KnowledgePropertyValue = string | number | boolean | string[] | null;

export interface KnowledgeNode {
  id: string;
  kind: KnowledgeNodeKind;
  title: string;
  body: string;
  properties: Record<string, KnowledgePropertyValue>;
  evidenceUris: string[];
  sourceHash: string;
  preferredPath?: string;
}

export interface KnowledgeEdge {
  id: string;
  from: string;
  to: string;
  relation: KnowledgeRelation;
  evidenceUri?: string | null;
}

export interface KnowledgeGraphIR {
  format: typeof KNOWLEDGE_GRAPH_FORMAT;
  schemaVersion: typeof KNOWLEDGE_GRAPH_SCHEMA_VERSION;
  projectId: string;
  generatedAt: string;
  graphHash: string;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export interface KnowledgeProjectInput {
  id: string;
  title: string;
  summary?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  sourceProvider?: string | null;
  properties?: Record<string, KnowledgePropertyValue>;
}

export interface KnowledgeDecisionInput {
  id: string;
  title: string;
  summary?: string | null;
  status?: string | null;
  consequences?: string[];
  evidenceUris?: string[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface KnowledgeTaskInput {
  id: string;
  title: string;
  status?: string | null;
  priority?: string | null;
  owner?: string | null;
  dueDate?: string | null;
  notes?: string | null;
  evidenceUris?: string[];
  dependsOnDecisionIds?: string[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface KnowledgeSupersessionInput {
  recordType?: "decision" | "task" | null;
  targetId: string;
  replacementId?: string | null;
  reason?: string | null;
  createdAt?: string | null;
}

export interface KnowledgeProjectStateInput {
  projectId: string;
  projectTitle?: string | null;
  stateVersion?: number | null;
  stateHash?: string | null;
  updatedAt?: string | null;
  status?: {
    summary?: string | null;
    phase?: string | null;
    health?: string | null;
    progressPercent?: number | null;
    blockers?: string[];
    nextActions?: string[];
  } | null;
  decisions?: KnowledgeDecisionInput[];
  tasks?: KnowledgeTaskInput[];
  supersessions?: KnowledgeSupersessionInput[];
}

export interface KnowledgeMemoryInput {
  id?: string | null;
  mode: "core" | "project" | "task" | string;
  title?: string | null;
  markdown: string;
  hash?: string | null;
  version?: number | null;
  approvedAt?: string | null;
  sourceStateVersion?: number | null;
  sources?: string[];
}

export interface KnowledgeConversationInput {
  canonical: CanonicalConversation;
  evidenceHash?: string | null;
  sourceHash?: string | null;
  archived?: boolean | null;
  projectTitle?: string | null;
  body?: string | null;
  activeMessageCount?: number | null;
  totalNodeCount?: number | null;
}

export interface KnowledgeAssetInput {
  id: string;
  title: string;
  mediaType?: string | null;
  byteLength?: number | null;
  contentHash?: string | null;
  localPath?: string | null;
  conversationIds?: string[];
  evidenceUris?: string[];
}

export interface CompileKnowledgeGraphInput {
  project: KnowledgeProjectInput;
  state?: KnowledgeProjectStateInput | null;
  memories?: KnowledgeMemoryInput[];
  conversations: KnowledgeConversationInput[];
  assets?: KnowledgeAssetInput[];
  contentObjects?: UnifiedContentObject[];
  contentRelations?: UnifiedContentRelation[];
  generatedAt?: string;
}

export interface KnowledgeGraphIssue {
  code:
    | "duplicate_node_id"
    | "duplicate_edge_id"
    | "duplicate_edge"
    | "dangling_edge"
    | "project_root_missing"
    | "project_root_duplicate"
    | "conversation_project_link_missing"
    | "conversation_project_link_duplicate"
    | "missing_source_hash"
    | "invalid_evidence_uri"
    | "missing_evidence_conversation"
    | "missing_evidence_content";
  path: string;
  message: string;
  value?: string | null;
}

export interface KnowledgeGraphValidationResult {
  ok: boolean;
  issues: KnowledgeGraphIssue[];
  metrics: {
    nodes: number;
    edges: number;
    duplicateNodeIds: number;
    duplicateEdgeIds: number;
    danglingEdges: number;
    missingEvidenceReferences: number;
    conversationCount: number;
  };
}

type ParsedEvidenceUri =
  | { kind: "conversation"; uri: string; conversationId: string; nodeId: string; evidenceHash: string }
  | { kind: "content"; uri: string; objectId: string; revision: number; contentHash: string };

const encoder = new TextEncoder();

const clean = (value: unknown, max = 20_000): string =>
  String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);

const unique = (values: readonly unknown[] | undefined, max = 500): string[] =>
  [...new Set((values ?? []).map((value) => clean(value, 4_000)).filter(Boolean))].slice(0, max);

const safeIdPart = (value: unknown, fallback = "item"): string =>
  clean(value, 300)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._:-]+/gu, "-")
    .replace(/^-+|-+$/g, "") || fallback;

const normalizeStable = (value: unknown, seen: WeakSet<object>): unknown => {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return String(value);
    if (typeof value === "bigint") return value.toString();
    return value;
  }
  if (seen.has(value)) throw new TypeError("Cannot stringify a circular value");
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => normalizeStable(entry, seen));
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") continue;
      output[key] = normalizeStable(entry, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
};

export const stableKnowledgeStringify = (value: unknown): string =>
  JSON.stringify(normalizeStable(value, new WeakSet<object>()));

export async function sha256KnowledgeHex(value: unknown): Promise<string> {
  const bytes = value instanceof Uint8Array
    ? value
    : encoder.encode(typeof value === "string" ? value : stableKnowledgeStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseKnowledgeEvidenceUri(value: unknown): ParsedEvidenceUri | null {
  const text = clean(value, 4_000);
  const conversation = text.match(/^contextvault:\/\/conversation\/([^/]+)\/node\/([^?]+)\?evidence=([^&#]+)$/i);
  const content = text.match(/^contextvault:\/\/content\/([^?]+)\?revision=(\d+)&hash=([^&#]+)$/i);
  try {
    if (conversation) return { kind: "conversation", uri: text, conversationId: decodeURIComponent(conversation[1]!), nodeId: decodeURIComponent(conversation[2]!), evidenceHash: decodeURIComponent(conversation[3]!) };
    if (content) return { kind: "content", uri: text, objectId: decodeURIComponent(content[1]!), revision: Number(content[2]), contentHash: decodeURIComponent(content[3]!) };
    return null;
  } catch { return null; }
}

const propertyRecord = (
  value: Record<string, KnowledgePropertyValue> | undefined,
): Record<string, KnowledgePropertyValue> => {
  const output: Record<string, KnowledgePropertyValue> = {};
  for (const [key, entry] of Object.entries(value ?? {})) {
    if (entry === undefined) continue;
    output[key] = Array.isArray(entry) ? unique(entry) : entry;
  }
  return output;
};

const renderContentPart = (part: CanonicalContentPart): string => {
  switch (part.type) {
    case "text":
      return part.text;
    case "code":
      return `\`\`\`${part.language ?? ""}\n${part.code}\n\`\`\``;
    case "image":
      return part.text ? `[Image: ${part.text}]` : "[Image]";
    case "file":
      return part.text ? `[File: ${part.text}]` : "[File]";
    case "citation":
      return part.text ? `[Citation: ${part.text}]` : "[Citation]";
    case "tool_call":
    case "tool_result":
    case "reasoning_summary":
    case "unknown":
      return "";
    case "canvas":
      return part.text ? `[Canvas: ${part.text}]` : "[Canvas]";
  }
};

const roleLabel = (role: CanonicalMessageNode["role"]): string => ({
  user: "User",
  assistant: "Assistant",
  system: "System",
  tool: "Tool",
  unknown: "Unknown",
})[role];

export function renderCanonicalConversationBody(conversation: CanonicalConversation): string {
  const activePath = conversation.activePath.length
    ? conversation.activePath
    : Object.keys(conversation.nodes).sort();
  const sections: string[] = [];
  for (const nodeId of activePath) {
    const node = conversation.nodes[nodeId];
    if (!node || node.content.length === 0) continue;
    const content = node.content.map(renderContentPart).filter(Boolean).join("\n\n").trim();
    if (!content) continue;
    const metadata = [node.createdAt, node.model].filter(Boolean).join(" · ");
    sections.push([
      `## ${roleLabel(node.role)}`,
      metadata ? `> ${metadata}` : "",
      content,
    ].filter(Boolean).join("\n\n"));
  }
  return sections.join("\n\n").trim();
}

const graphNodeId = {
  project: (projectId: string): string => `project:${safeIdPart(projectId, "project")}`,
  conversation: (conversationId: string): string => `conversation:${safeIdPart(conversationId, "conversation")}`,
  decision: (projectId: string, decisionId: string): string => `decision:${safeIdPart(projectId)}:${safeIdPart(decisionId, "decision")}`,
  task: (projectId: string, taskId: string): string => `task:${safeIdPart(projectId)}:${safeIdPart(taskId, "task")}`,
  memory: (projectId: string, memoryId: string): string => `memory:${safeIdPart(projectId)}:${safeIdPart(memoryId, "memory")}`,
  evidence: (projectId: string): string => `evidence:${safeIdPart(projectId)}:index`,
  asset: (projectId: string, assetId: string): string => `asset:${safeIdPart(projectId)}:${safeIdPart(assetId, "asset")}`,
  content: (projectId: string, objectId: string): string => `content:${safeIdPart(projectId)}:${safeIdPart(objectId, "content")}`,
};

const edgeId = (from: string, relation: KnowledgeRelation, to: string, evidenceUri?: string | null): string => {
  const suffix = evidenceUri ? `:${safeIdPart(evidenceUri, "evidence")}` : "";
  return `edge:${from}:${relation}:${to}${suffix}`;
};

const addEdge = (
  edges: KnowledgeEdge[],
  from: string,
  relation: KnowledgeRelation,
  to: string,
  evidenceUri?: string | null,
): void => {
  edges.push({
    id: edgeId(from, relation, to, evidenceUri),
    from,
    to,
    relation,
    ...(evidenceUri ? { evidenceUri } : {}),
  });
};

const nodeSourceHash = async (kind: KnowledgeNodeKind, value: unknown, known?: string | null): Promise<string> => {
  const supplied = clean(known, 200);
  if (supplied) return supplied.startsWith("sha256:") ? supplied : `sha256:${supplied}`;
  return `sha256:${await sha256KnowledgeHex({ kind, value })}`;
};

const evidenceConversationIds = (uris: string[]): Array<{ uri: string; conversationId: string }> => {
  const output: Array<{ uri: string; conversationId: string }> = [];
  for (const uri of unique(uris)) {
    const parsed = parseKnowledgeEvidenceUri(uri);
    if (parsed?.kind === "conversation") output.push({ uri, conversationId: parsed.conversationId });
  }
  return output;
};

const sortNodes = (nodes: KnowledgeNode[]): KnowledgeNode[] =>
  [...nodes].sort((left, right) => left.id.localeCompare(right.id));

const sortEdges = (edges: KnowledgeEdge[]): KnowledgeEdge[] =>
  [...edges].sort((left, right) => left.id.localeCompare(right.id));

const stateSummaryBody = (state: KnowledgeProjectStateInput | null | undefined): string => {
  if (!state?.status) return "";
  const status = state.status;
  const lines = [
    status.summary ? `Summary: ${clean(status.summary)}` : "",
    status.phase ? `Phase: ${clean(status.phase, 500)}` : "",
    status.health ? `Health: ${clean(status.health, 100)}` : "",
    status.progressPercent !== null && status.progressPercent !== undefined
      ? `Progress: ${Math.max(0, Math.min(100, Math.round(status.progressPercent)))}%`
      : "",
    ...(status.blockers?.length ? ["", "Blockers:", ...unique(status.blockers).map((item) => `- ${item}`)] : []),
    ...(status.nextActions?.length ? ["", "Next actions:", ...unique(status.nextActions).map((item) => `- ${item}`)] : []),
  ].filter(Boolean);
  return lines.join("\n").trim();
};

export async function compileKnowledgeGraph(
  input: CompileKnowledgeGraphInput,
): Promise<KnowledgeGraphIR> {
  const projectId = clean(input.project?.id, 300);
  if (!projectId) throw new Error("Project id is required");
  const projectTitle = clean(input.project.title, 500) || projectId;
  if (input.state?.projectId && input.state.projectId !== projectId) {
    throw new Error(`State project mismatch: expected ${projectId}, received ${input.state.projectId}`);
  }

  const projectNodeId = graphNodeId.project(projectId);
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const conversations = [...input.conversations].sort((left, right) =>
    left.canonical.conversationId.localeCompare(right.canonical.conversationId));
  const conversationNodeBySourceId = new Map<string, string>();

  const projectBody = [
    clean(input.project.summary),
    stateSummaryBody(input.state),
  ].filter(Boolean).join("\n\n");
  nodes.push({
    id: projectNodeId,
    kind: "project",
    title: projectTitle,
    body: projectBody,
    properties: propertyRecord({
      project_id: projectId,
      created_at: input.project.createdAt ?? null,
      updated_at: input.project.updatedAt ?? input.state?.updatedAt ?? null,
      source_provider: input.project.sourceProvider ?? "chatgpt",
      state_version: input.state?.stateVersion ?? 0,
      state_hash: input.state?.stateHash ?? null,
      ...input.project.properties,
    }),
    evidenceUris: [],
    sourceHash: await nodeSourceHash("project", {
      project: input.project,
      status: input.state?.status ?? null,
      stateVersion: input.state?.stateVersion ?? 0,
      stateHash: input.state?.stateHash ?? null,
    }),
  });

  for (const entry of conversations) {
    const conversation = entry.canonical;
    if (conversation.projectId && conversation.projectId !== projectId) {
      throw new Error(`Conversation ${conversation.conversationId} belongs to ${conversation.projectId}, not ${projectId}`);
    }
    const id = graphNodeId.conversation(conversation.conversationId);
    conversationNodeBySourceId.set(conversation.conversationId, id);
    nodes.push({
      id,
      kind: "conversation",
      title: clean(conversation.title, 500) || "Untitled conversation",
      body: entry.body === undefined ? renderCanonicalConversationBody(conversation) : clean(entry.body, 1_000_000),
      properties: {
        conversation_id: conversation.conversationId,
        project_id: projectId,
        created_at: conversation.createdAt,
        updated_at: conversation.updatedAt,
        archived: Boolean(entry.archived),
        source_provider: conversation.source.provider,
        source_adapter: conversation.source.adapter,
        active_message_count: entry.activeMessageCount ?? conversation.activePath.length,
        total_node_count: entry.totalNodeCount ?? Object.keys(conversation.nodes).length,
      },
      evidenceUris: [],
      sourceHash: await nodeSourceHash("conversation", conversation, entry.sourceHash ?? entry.evidenceHash),
    });
    addEdge(edges, id, "belongs_to", projectNodeId);
  }

  const contentNodeByObjectId = new Map<string, string>();
  for (const object of [...(input.contentObjects ?? [])].filter((row) => row.projectId === projectId && row.status !== "trashed").sort((a, b) => a.id.localeCompare(b.id))) {
    const id = graphNodeId.content(projectId, object.id);
    contentNodeByObjectId.set(object.id, id);
    nodes.push({
      id,
      kind: "content",
      title: clean(object.title, 500) || object.id,
      body: clean(object.body, 1_000_000),
      properties: {
        project_id: projectId,
        content_id: object.id,
        content_kind: object.kind,
        content_status: object.status,
        content_revision: object.revision,
        body_format: object.bodyFormat,
        tags: object.tags,
        created_at: object.createdAt,
        updated_at: object.updatedAt,
        raw_object_key: object.source.rawObjectKey,
      },
      evidenceUris: unique(object.evidenceUris),
      sourceHash: object.contentHash,
    });
    addEdge(edges, id, "belongs_to", projectNodeId);
    for (const evidence of evidenceConversationIds(object.evidenceUris)) {
      const conversationNodeId = conversationNodeBySourceId.get(evidence.conversationId);
      if (conversationNodeId) addEdge(edges, id, "derived_from", conversationNodeId, evidence.uri);
    }
  }
  for (const relation of [...(input.contentRelations ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    const from = contentNodeByObjectId.get(relation.fromId);
    const to = contentNodeByObjectId.get(relation.toId);
    if (!from || !to) continue;
    const supported: KnowledgeRelation = relation.relation === "supports" || relation.relation === "depends_on" || relation.relation === "supersedes" || relation.relation === "references" || relation.relation === "related_to" || relation.relation === "contains" || relation.relation === "derived_from"
      ? relation.relation
      : "related_to";
    addEdge(edges, from, supported, to, relation.evidenceUri);
  }

  const decisions = [...(input.state?.decisions ?? [])].sort((left, right) => left.id.localeCompare(right.id));
  for (const decision of decisions) {
    const id = graphNodeId.decision(projectId, decision.id);
    const evidenceUris = unique(decision.evidenceUris);
    nodes.push({
      id,
      kind: "decision",
      title: clean(decision.title, 500) || decision.id,
      body: [
        clean(decision.summary),
        ...(decision.consequences?.length ? ["Consequences:", ...unique(decision.consequences).map((item) => `- ${item}`)] : []),
      ].filter(Boolean).join("\n\n"),
      properties: {
        project_id: projectId,
        decision_id: decision.id,
        status: decision.status ?? "active",
        created_at: decision.createdAt ?? null,
        updated_at: decision.updatedAt ?? null,
      },
      evidenceUris,
      sourceHash: await nodeSourceHash("decision", decision),
    });
    addEdge(edges, id, "belongs_to", projectNodeId);
    for (const evidence of evidenceConversationIds(evidenceUris)) {
      const conversationNodeId = conversationNodeBySourceId.get(evidence.conversationId);
      if (conversationNodeId) addEdge(edges, id, "derived_from", conversationNodeId, evidence.uri);
    }
  }

  const tasks = [...(input.state?.tasks ?? [])].sort((left, right) => left.id.localeCompare(right.id));
  for (const task of tasks) {
    const id = graphNodeId.task(projectId, task.id);
    const evidenceUris = unique(task.evidenceUris);
    nodes.push({
      id,
      kind: "task",
      title: clean(task.title, 500) || task.id,
      body: clean(task.notes),
      properties: {
        project_id: projectId,
        task_id: task.id,
        status: task.status ?? "todo",
        priority: task.priority ?? "medium",
        owner: task.owner ?? null,
        due_date: task.dueDate ?? null,
        created_at: task.createdAt ?? null,
        updated_at: task.updatedAt ?? null,
      },
      evidenceUris,
      sourceHash: await nodeSourceHash("task", task),
    });
    addEdge(edges, id, "belongs_to", projectNodeId);
    for (const evidence of evidenceConversationIds(evidenceUris)) {
      const conversationNodeId = conversationNodeBySourceId.get(evidence.conversationId);
      if (conversationNodeId) addEdge(edges, id, "derived_from", conversationNodeId, evidence.uri);
    }
    for (const decisionId of unique(task.dependsOnDecisionIds)) {
      addEdge(edges, id, "depends_on", graphNodeId.decision(projectId, decisionId));
    }
  }

  for (const supersession of input.state?.supersessions ?? []) {
    if (!supersession.replacementId) continue;
    const type = supersession.recordType === "task" ? "task" : "decision";
    const target = type === "task"
      ? graphNodeId.task(projectId, supersession.targetId)
      : graphNodeId.decision(projectId, supersession.targetId);
    const replacement = type === "task"
      ? graphNodeId.task(projectId, supersession.replacementId)
      : graphNodeId.decision(projectId, supersession.replacementId);
    addEdge(edges, replacement, "supersedes", target);
  }

  const memories = [...(input.memories ?? [])].sort((left, right) => {
    const leftKey = `${left.mode}:${left.version ?? 0}:${left.id ?? ""}`;
    const rightKey = `${right.mode}:${right.version ?? 0}:${right.id ?? ""}`;
    return leftKey.localeCompare(rightKey);
  });
  for (const memory of memories) {
    const memoryKey = memory.id || `${memory.mode}:v${memory.version ?? 0}`;
    const id = graphNodeId.memory(projectId, memoryKey);
    const evidenceUris = unique(memory.sources);
    nodes.push({
      id,
      kind: "memory",
      title: clean(memory.title, 500) || `${projectTitle} · ${memory.mode} memory`,
      body: clean(memory.markdown, 1_000_000),
      properties: {
        project_id: projectId,
        memory_mode: clean(memory.mode, 100),
        memory_version: memory.version ?? null,
        approved_at: memory.approvedAt ?? null,
        source_state_version: memory.sourceStateVersion ?? null,
      },
      evidenceUris,
      sourceHash: await nodeSourceHash("memory", memory, memory.hash),
    });
    addEdge(edges, id, "belongs_to", projectNodeId);
    for (const evidence of evidenceConversationIds(evidenceUris)) {
      const conversationNodeId = conversationNodeBySourceId.get(evidence.conversationId);
      if (conversationNodeId) addEdge(edges, id, "summarizes", conversationNodeId, evidence.uri);
    }
  }

  const evidenceNodeId = graphNodeId.evidence(projectId);
  const allEvidenceUris = unique([
    ...nodes.flatMap((node) => node.evidenceUris),
  ], 10_000);
  nodes.push({
    id: evidenceNodeId,
    kind: "evidence",
    title: `${projectTitle} · Evidence Index`,
    body: allEvidenceUris.length ? allEvidenceUris.map((uri) => `- ${uri}`).join("\n") : "No evidence URI recorded.",
    properties: {
      project_id: projectId,
      evidence_count: allEvidenceUris.length,
    },
    evidenceUris: allEvidenceUris,
    sourceHash: await nodeSourceHash("evidence", allEvidenceUris),
  });
  addEdge(edges, evidenceNodeId, "belongs_to", projectNodeId);
  for (const conversationId of [...conversationNodeBySourceId.keys()].sort()) {
    const conversationNodeId = conversationNodeBySourceId.get(conversationId);
    if (conversationNodeId) addEdge(edges, evidenceNodeId, "references", conversationNodeId);
  }

  for (const asset of [...(input.assets ?? [])].sort((left, right) => left.id.localeCompare(right.id))) {
    const id = graphNodeId.asset(projectId, asset.id);
    const evidenceUris = unique(asset.evidenceUris);
    nodes.push({
      id,
      kind: "asset",
      title: clean(asset.title, 500) || asset.id,
      body: "",
      properties: {
        project_id: projectId,
        asset_id: asset.id,
        media_type: asset.mediaType ?? null,
        byte_length: asset.byteLength ?? null,
        local_path: asset.localPath ?? null,
        content_hash: asset.contentHash ?? null,
      },
      evidenceUris,
      sourceHash: await nodeSourceHash("asset", asset, asset.contentHash),
    });
    addEdge(edges, id, "belongs_to", projectNodeId);
    for (const conversationId of unique(asset.conversationIds)) {
      const conversationNodeId = conversationNodeBySourceId.get(conversationId);
      if (conversationNodeId) addEdge(edges, id, "references", conversationNodeId);
    }
  }

  const sortedNodes = sortNodes(nodes);
  const sortedEdges = sortEdges(edges);
  const graphHash = await sha256KnowledgeHex({
    format: KNOWLEDGE_GRAPH_FORMAT,
    schemaVersion: KNOWLEDGE_GRAPH_SCHEMA_VERSION,
    projectId,
    nodes: sortedNodes.map(({ body: _body, ...node }) => node),
    edges: sortedEdges,
  });
  return {
    format: KNOWLEDGE_GRAPH_FORMAT,
    schemaVersion: KNOWLEDGE_GRAPH_SCHEMA_VERSION,
    projectId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    graphHash: `sha256:${graphHash}`,
    nodes: sortedNodes,
    edges: sortedEdges,
  };
}

export function validateKnowledgeGraph(value: KnowledgeGraphIR): KnowledgeGraphValidationResult {
  const issues: KnowledgeGraphIssue[] = [];
  const nodeCounts = new Map<string, number>();
  const edgeCounts = new Map<string, number>();
  for (const node of value.nodes) nodeCounts.set(node.id, (nodeCounts.get(node.id) ?? 0) + 1);
  for (const edge of value.edges) edgeCounts.set(edge.id, (edgeCounts.get(edge.id) ?? 0) + 1);

  for (const [id, count] of nodeCounts) {
    if (count > 1) issues.push({ code: "duplicate_node_id", path: `nodes.${id}`, message: `Duplicate node id: ${id}`, value: id });
  }
  for (const [id, count] of edgeCounts) {
    if (count > 1) issues.push({ code: "duplicate_edge_id", path: `edges.${id}`, message: `Duplicate edge id: ${id}`, value: id });
  }

  const nodeIds = new Set(value.nodes.map((node) => node.id));
  const semanticEdges = new Set<string>();
  for (const edge of value.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      issues.push({ code: "dangling_edge", path: `edges.${edge.id}`, message: `Edge references a missing node: ${edge.from} -> ${edge.to}`, value: edge.id });
    }
    const semanticKey = `${edge.from}\u0000${edge.relation}\u0000${edge.to}\u0000${edge.evidenceUri ?? ""}`;
    if (semanticEdges.has(semanticKey)) {
      issues.push({ code: "duplicate_edge", path: `edges.${edge.id}`, message: `Duplicate semantic edge: ${edge.from} ${edge.relation} ${edge.to}`, value: edge.id });
    }
    semanticEdges.add(semanticKey);
  }

  const projectNodes = value.nodes.filter((node) => node.kind === "project" && node.properties.project_id === value.projectId);
  if (projectNodes.length === 0) issues.push({ code: "project_root_missing", path: "nodes", message: `Project root is missing for ${value.projectId}`, value: value.projectId });
  if (projectNodes.length > 1) issues.push({ code: "project_root_duplicate", path: "nodes", message: `Multiple project roots exist for ${value.projectId}`, value: value.projectId });
  const projectNodeId = projectNodes[0]?.id;

  for (const node of value.nodes) {
    if (!clean(node.sourceHash, 300)) {
      issues.push({ code: "missing_source_hash", path: `nodes.${node.id}.sourceHash`, message: `Node has no source hash: ${node.id}`, value: node.id });
    }
    if (node.kind === "conversation" && projectNodeId) {
      const links = value.edges.filter((edge) => edge.from === node.id && edge.to === projectNodeId && edge.relation === "belongs_to");
      if (links.length === 0) issues.push({ code: "conversation_project_link_missing", path: `nodes.${node.id}`, message: `Conversation is not linked to the selected Project: ${node.id}`, value: node.id });
      if (links.length > 1) issues.push({ code: "conversation_project_link_duplicate", path: `nodes.${node.id}`, message: `Conversation has multiple Project links: ${node.id}`, value: node.id });
    }
    for (const uri of node.evidenceUris) {
      const parsed = parseKnowledgeEvidenceUri(uri);
      if (!parsed) {
        issues.push({ code: "invalid_evidence_uri", path: `nodes.${node.id}.evidenceUris`, message: `Invalid evidence URI: ${uri}`, value: uri });
        continue;
      }
      if (parsed.kind === "conversation" && !nodeIds.has(graphNodeId.conversation(parsed.conversationId))) {
        issues.push({ code: "missing_evidence_conversation", path: `nodes.${node.id}.evidenceUris`, message: `Evidence conversation is not present in the graph: ${parsed.conversationId}`, value: uri });
      }
      if (parsed.kind === "content" && !nodeIds.has(graphNodeId.content(value.projectId, parsed.objectId))) {
        issues.push({ code: "missing_evidence_content", path: `nodes.${node.id}.evidenceUris`, message: `Evidence content object is not present in the graph: ${parsed.objectId}`, value: uri });
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    metrics: {
      nodes: value.nodes.length,
      edges: value.edges.length,
      duplicateNodeIds: issues.filter((issue) => issue.code === "duplicate_node_id").length,
      duplicateEdgeIds: issues.filter((issue) => issue.code === "duplicate_edge_id").length,
      danglingEdges: issues.filter((issue) => issue.code === "dangling_edge").length,
      missingEvidenceReferences: issues.filter((issue) => issue.code === "invalid_evidence_uri" || issue.code === "missing_evidence_conversation" || issue.code === "missing_evidence_content").length,
      conversationCount: value.nodes.filter((node) => node.kind === "conversation").length,
    },
  };
}

export function assertKnowledgeGraph(value: KnowledgeGraphIR): void {
  const validation = validateKnowledgeGraph(value);
  if (!validation.ok) {
    throw new Error(`Knowledge graph validation failed: ${validation.issues.map((issue) => `${issue.code}@${issue.path}`).join(", ")}`);
  }
}
