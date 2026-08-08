export const LEGACY_CANONICAL_SCHEMA_VERSION = "0.1" as const;
export const CANONICAL_SCHEMA_VERSION = "0.2" as const;
export const SUPPORTED_CANONICAL_SCHEMA_VERSIONS = [LEGACY_CANONICAL_SCHEMA_VERSION, CANONICAL_SCHEMA_VERSION] as const;

export type ProviderId = string;
export type CaptureMode = "structured" | "visible-only" | "official-import" | "unknown";

export interface CanonicalCollectionRef {
  provider: ProviderId;
  collectionId: string;
  kind: string;
  title: string | null;
  nativeId: string | null;
  metadata: Record<string, unknown>;
}

export type CanonicalRole = "user" | "assistant" | "system" | "tool" | "unknown";

export type CanonicalSemanticType =
  | "user"
  | "user_voice_transcript"
  | "assistant_final"
  | "assistant_voice_transcript"
  | "assistant_intermediate"
  | "tool_call"
  | "tool_result"
  | "reasoning"
  | "system"
  | "developer"
  | "unknown";

export interface TextContentPart {
  type: "text";
  text: string;
  rawPayload: unknown;
}

export interface CodeContentPart {
  type: "code";
  code: string;
  language: string | null;
  rawPayload: unknown;
}

export interface KnownStructuredContentPart {
  type:
    | "image"
    | "file"
    | "citation"
    | "tool_call"
    | "tool_result"
    | "canvas"
    | "reasoning_summary";
  text: string | null;
  rawPayload: unknown;
}

export interface UnknownContentPart {
  type: "unknown";
  sourceType: string;
  text: string | null;
  rawPayload: unknown;
}

export type CanonicalContentPart =
  | TextContentPart
  | CodeContentPart
  | KnownStructuredContentPart
  | UnknownContentPart;

export interface CanonicalMessageNode {
  nodeId: string;
  parentId: string | null;
  childrenIds: string[];
  messageId: string | null;
  role: CanonicalRole;
  /**
   * Provider-neutral semantic classification. `role` alone is insufficient
   * because ChatGPT represents tool dispatch and progress events as
   * assistant-authored messages.
   */
  semanticType?: CanonicalSemanticType;
  /** Stable grouping hint for cumulative or delta streaming fragments. */
  streamGroupId?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  content: CanonicalContentPart[];
  model: string | null;
  status: string | null;
  metadata: Record<string, unknown>;
  rawPayload: unknown;
}

export interface CanonicalEdge {
  from: string;
  to: string;
}

export interface CanonicalConversation {
  schemaVersion: typeof CANONICAL_SCHEMA_VERSION | typeof LEGACY_CANONICAL_SCHEMA_VERSION;
  conversationId: string;
  title: string;
  source: {
    provider: ProviderId;
    adapter: string;
    sourceUrl: string | null;
    captureMode?: CaptureMode;
    completeness?: "verified" | "partial" | "visible-only" | "unknown";
  };
  createdAt: string | null;
  updatedAt: string | null;
  currentNodeId: string | null;
  nodes: Record<string, CanonicalMessageNode>;
  edges: CanonicalEdge[];
  activePath: string[];
  /** Legacy provider-native project identifier retained for v0.1 compatibility. */
  projectId: string | null;
  primaryCollectionId?: string | null;
  collectionRefs?: CanonicalCollectionRef[];
  metadata: Record<string, unknown>;
  rawMetadata: unknown;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function validateCanonicalConversation(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "$", message: "Expected an object" }] };
  }

  if (!SUPPORTED_CANONICAL_SCHEMA_VERSIONS.includes(value.schemaVersion as never)) {
    issues.push({ path: "schemaVersion", message: `Expected one of ${SUPPORTED_CANONICAL_SCHEMA_VERSIONS.join(", ")}` });
  }
  if (typeof value.conversationId !== "string" || value.conversationId.length === 0) {
    issues.push({ path: "conversationId", message: "Expected a non-empty string" });
  }
  if (typeof value.title !== "string") {
    issues.push({ path: "title", message: "Expected a string" });
  }
  if (!isRecord(value.nodes)) {
    issues.push({ path: "nodes", message: "Expected a node record" });
  }
  if (!Array.isArray(value.activePath) || !value.activePath.every((entry) => typeof entry === "string")) {
    issues.push({ path: "activePath", message: "Expected an array of node IDs" });
  }
  if (!Array.isArray(value.edges)) {
    issues.push({ path: "edges", message: "Expected an array" });
  }

  return { ok: issues.length === 0, issues };
}

export function upgradeCanonicalConversation(value: CanonicalConversation): CanonicalConversation {
  if (value.schemaVersion === CANONICAL_SCHEMA_VERSION) return value;
  const projectId = typeof value.projectId === "string" && value.projectId ? value.projectId : null;
  return {
    ...value,
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    source: {
      ...value.source,
      captureMode: value.source.captureMode ?? "structured",
      completeness: value.source.completeness ?? "unknown",
    },
    primaryCollectionId: value.primaryCollectionId ?? projectId,
    collectionRefs: value.collectionRefs ?? (projectId ? [{
      provider: value.source.provider || "chatgpt",
      collectionId: projectId,
      kind: "project",
      title: null,
      nativeId: projectId,
      metadata: {},
    }] : []),
  };
}

export function assertCanonicalConversation(value: unknown): asserts value is CanonicalConversation {
  const result = validateCanonicalConversation(value);
  if (!result.ok) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`Canonical Schema validation failed: ${detail}`);
  }
}
