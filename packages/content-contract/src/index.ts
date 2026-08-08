export const CONTENT_OBJECT_FORMAT = "kv-archive-content-object" as const;
export const CONTENT_OBJECT_SCHEMA_VERSION = 1 as const;
export const CONTENT_VERSION_FORMAT = "kv-archive-content-version" as const;
export const CONTENT_RELATION_FORMAT = "kv-archive-content-relation" as const;
export const CONTENT_OPERATION_FORMAT = "kv-archive-content-operation" as const;
export const CONTENT_PROMOTION_FORMAT = "kv-archive-content-promotion" as const;

export type ContentObjectKind =
  | "note"
  | "flash"
  | "web_excerpt"
  | "ai_excerpt"
  | "conversation"
  | "image"
  | "file";

export type ContentObjectStatus = "active" | "archived" | "trashed";
export type ContentBodyFormat = "plain" | "markdown";
export type ContentRelationType =
  | "belongs_to"
  | "references"
  | "derived_from"
  | "supports"
  | "depends_on"
  | "supersedes"
  | "related_to"
  | "contains"
  | "promoted_to";
export type ContentOperationType = "create" | "update" | "archive" | "restore" | "trash" | "link" | "unlink" | "promote" | "import";
export type ContentPromotionTarget = "memory" | "decision" | "task";
export type ContentPromotionStatus = "pending_review" | "submitted" | "applied" | "rejected";

export interface ContentSourceRef {
  provider: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  rawObjectKey: string | null;
  capturedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface ContentAttachmentRef {
  id: string;
  objectKey: string | null;
  fileName: string | null;
  mediaType: string | null;
  sizeBytes: number | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
}

export interface UnifiedContentObject {
  format: typeof CONTENT_OBJECT_FORMAT;
  schemaVersion: typeof CONTENT_OBJECT_SCHEMA_VERSION;
  id: string;
  kind: ContentObjectKind;
  projectId: string | null;
  projectTitle: string | null;
  title: string;
  body: string;
  bodyFormat: ContentBodyFormat;
  summary: string | null;
  tags: string[];
  status: ContentObjectStatus;
  source: ContentSourceRef;
  attachments: ContentAttachmentRef[];
  evidenceUris: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  trashedAt: string | null;
  contentHash: string;
  metadata: Record<string, unknown>;
}

export interface ContentVersion {
  format: typeof CONTENT_VERSION_FORMAT;
  schemaVersion: 1;
  key: string;
  objectId: string;
  revision: number;
  createdAt: string;
  reason: string;
  snapshot: UnifiedContentObject;
  snapshotHash: string;
}

export interface ContentRelation {
  format: typeof CONTENT_RELATION_FORMAT;
  schemaVersion: 1;
  id: string;
  projectId: string | null;
  fromId: string;
  toId: string;
  relation: ContentRelationType;
  label: string | null;
  evidenceUri: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface ContentOperation {
  format: typeof CONTENT_OPERATION_FORMAT;
  schemaVersion: 1;
  id: string;
  objectId: string;
  projectId: string | null;
  type: ContentOperationType;
  expectedRevision: number | null;
  resultingRevision: number;
  beforeHash: string | null;
  afterHash: string | null;
  actor: string;
  createdAt: string;
  details: Record<string, unknown>;
}

export interface ContentPromotion {
  format: typeof CONTENT_PROMOTION_FORMAT;
  schemaVersion: 1;
  id: string;
  projectId: string;
  projectTitle: string;
  sourceObjectId: string;
  sourceRevision: number;
  sourceEvidenceUri: string;
  targetKind: ContentPromotionTarget;
  status: ContentPromotionStatus;
  title: string;
  draft: Record<string, unknown>;
  createdAt: string;
  reviewedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface ValidationIssue { path: string; message: string; }
export interface ValidationResult { ok: boolean; issues: ValidationIssue[]; }

const encoder = new TextEncoder();
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const clean = (value: unknown, max = 100_000): string => String(value ?? "").trim().slice(0, max);
const cleanNullable = (value: unknown, max = 4_000): string | null => clean(value, max) || null;
const uniqueStrings = (value: unknown, max = 500): string[] => [...new Set((Array.isArray(value) ? value : []).map((item) => clean(item, 4_000)).filter(Boolean))].slice(0, max);
const safeId = (value: unknown, fallback = ""): string => clean(value || fallback, 240).replace(/[^a-zA-Z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
const isoOr = (value: unknown, fallback: string): string => {
  const text = clean(value, 100);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : fallback;
};

function normalizeStable(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalizeStable);
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().filter((key) => key !== "contentHash").map((key) => [key, normalizeStable((value as Record<string, unknown>)[key])]));
}

export function stableContentStringify(value: unknown): string { return JSON.stringify(normalizeStable(value)); }

export async function sha256Content(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(stableContentStringify(value)));
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function normalizeSource(value: unknown): ContentSourceRef {
  const row = isRecord(value) ? value : {};
  return {
    provider: cleanNullable(row.provider, 120),
    sourceId: cleanNullable(row.sourceId, 500),
    sourceUrl: cleanNullable(row.sourceUrl, 4_000),
    rawObjectKey: cleanNullable(row.rawObjectKey, 500),
    capturedAt: cleanNullable(row.capturedAt, 100),
    metadata: isRecord(row.metadata) ? structuredClone(row.metadata) : {},
  };
}

function normalizeAttachments(value: unknown): ContentAttachmentRef[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).map((item, index) => {
    const row = isRecord(item) ? item : {};
    return {
      id: safeId(row.id, `attachment-${index + 1}`),
      objectKey: cleanNullable(row.objectKey, 500),
      fileName: cleanNullable(row.fileName, 1_000),
      mediaType: cleanNullable(row.mediaType, 300),
      sizeBytes: Number.isFinite(Number(row.sizeBytes)) ? Math.max(0, Number(row.sizeBytes)) : null,
      contentHash: cleanNullable(row.contentHash, 300),
      metadata: isRecord(row.metadata) ? structuredClone(row.metadata) : {},
    };
  });
}

export async function normalizeContentObject(value: unknown, options: { id?: string; now?: string; revision?: number } = {}): Promise<UnifiedContentObject> {
  const row = isRecord(value) ? value : {};
  const now = isoOr(options.now, new Date().toISOString());
  const id = safeId(row.id, safeId(options.id, `content-${now.replace(/[^0-9]/g, "").slice(0, 14)}`));
  if (!id) throw new Error("Content object id is required");
  const allowedKinds = new Set<ContentObjectKind>(["note", "flash", "web_excerpt", "ai_excerpt", "conversation", "image", "file"]);
  const kind = allowedKinds.has(row.kind as ContentObjectKind) ? row.kind as ContentObjectKind : "note";
  const allowedStatuses = new Set<ContentObjectStatus>(["active", "archived", "trashed"]);
  const status = allowedStatuses.has(row.status as ContentObjectStatus) ? row.status as ContentObjectStatus : "active";
  const createdAt = isoOr(row.createdAt, now);
  const updatedAt = isoOr(row.updatedAt, now);
  const base: Omit<UnifiedContentObject, "contentHash"> = {
    format: CONTENT_OBJECT_FORMAT,
    schemaVersion: CONTENT_OBJECT_SCHEMA_VERSION,
    id,
    kind,
    projectId: cleanNullable(row.projectId, 300),
    projectTitle: cleanNullable(row.projectTitle, 500),
    title: clean(row.title, 1_000) || (kind === "flash" ? clean(row.body, 80) : "Untitled"),
    body: clean(row.body, 2_000_000),
    bodyFormat: row.bodyFormat === "plain" ? "plain" : "markdown",
    summary: cleanNullable(row.summary, 20_000),
    tags: uniqueStrings(row.tags, 200),
    status,
    source: normalizeSource(row.source),
    attachments: normalizeAttachments(row.attachments),
    evidenceUris: uniqueStrings(row.evidenceUris, 500),
    revision: Math.max(1, Math.floor(Number(options.revision ?? row.revision ?? 1))),
    createdAt,
    updatedAt,
    archivedAt: status === "archived" ? isoOr(row.archivedAt, updatedAt) : null,
    trashedAt: status === "trashed" ? isoOr(row.trashedAt, updatedAt) : null,
    metadata: isRecord(row.metadata) ? structuredClone(row.metadata) : {},
  };
  return { ...base, contentHash: `sha256:${await sha256Content(base)}` };
}

export function validateContentObject(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return { ok: false, issues: [{ path: "$", message: "Expected an object" }] };
  if (value.format !== CONTENT_OBJECT_FORMAT) issues.push({ path: "format", message: `Expected ${CONTENT_OBJECT_FORMAT}` });
  if (value.schemaVersion !== CONTENT_OBJECT_SCHEMA_VERSION) issues.push({ path: "schemaVersion", message: "Expected schema version 1" });
  if (!clean(value.id, 240)) issues.push({ path: "id", message: "Expected a non-empty id" });
  if (!clean(value.title, 1_000)) issues.push({ path: "title", message: "Expected a non-empty title" });
  if (!Number.isInteger(value.revision) || Number(value.revision) < 1) issues.push({ path: "revision", message: "Expected a positive integer" });
  if (!clean(value.contentHash, 300).startsWith("sha256:")) issues.push({ path: "contentHash", message: "Expected a sha256 content hash" });
  return { ok: issues.length === 0, issues };
}

export function contentEvidenceUri(value: Pick<UnifiedContentObject, "id" | "revision" | "contentHash">): string {
  return `contextvault://content/${encodeURIComponent(value.id)}?revision=${value.revision}&hash=${encodeURIComponent(value.contentHash)}`;
}

export function parseContentEvidenceUri(value: unknown): { uri: string; objectId: string; revision: number; contentHash: string } | null {
  const text = clean(value, 4_000);
  const match = text.match(/^contextvault:\/\/content\/([^?]+)\?revision=(\d+)&hash=([^&#]+)$/i);
  if (!match) return null;
  try {
    return { uri: text, objectId: decodeURIComponent(match[1]!), revision: Number(match[2]), contentHash: decodeURIComponent(match[3]!) };
  } catch { return null; }
}

export function contentVersionKey(objectId: string, revision: number): string { return `${objectId}:v${revision}`; }

export function createContentVersion(snapshot: UnifiedContentObject, reason = "update", createdAt = new Date().toISOString()): ContentVersion {
  return {
    format: CONTENT_VERSION_FORMAT,
    schemaVersion: 1,
    key: contentVersionKey(snapshot.id, snapshot.revision),
    objectId: snapshot.id,
    revision: snapshot.revision,
    createdAt: isoOr(createdAt, new Date().toISOString()),
    reason: clean(reason, 500) || "update",
    snapshot: structuredClone(snapshot),
    snapshotHash: snapshot.contentHash,
  };
}

export async function updateContentObject(current: UnifiedContentObject, patch: Record<string, unknown>, options: { expectedRevision?: number; now?: string; actor?: string; type?: ContentOperationType } = {}): Promise<{ object: UnifiedContentObject; version: ContentVersion; operation: ContentOperation }> {
  if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision) throw new Error(`Content revision conflict: expected ${options.expectedRevision}, current ${current.revision}`);
  const now = isoOr(options.now, new Date().toISOString());
  const next = await normalizeContentObject({ ...current, ...structuredClone(patch), id: current.id, createdAt: current.createdAt, updatedAt: now }, { revision: current.revision + 1, now });
  const version = createContentVersion(next, options.type || "update", now);
  const operation: ContentOperation = {
    format: CONTENT_OPERATION_FORMAT,
    schemaVersion: 1,
    id: `content-op:${current.id}:${next.revision}:${now}`,
    objectId: current.id,
    projectId: next.projectId,
    type: options.type || "update",
    expectedRevision: options.expectedRevision ?? current.revision,
    resultingRevision: next.revision,
    beforeHash: current.contentHash,
    afterHash: next.contentHash,
    actor: clean(options.actor, 200) || "local-user",
    createdAt: now,
    details: { changedFields: Object.keys(patch).sort() },
  };
  return { object: next, version, operation };
}

export function createContentRelation(value: Partial<ContentRelation> & Pick<ContentRelation, "fromId" | "toId" | "relation">, now = new Date().toISOString()): ContentRelation {
  if (!clean(value.fromId, 240) || !clean(value.toId, 240)) throw new Error("Relation endpoints are required");
  if (value.fromId === value.toId && value.relation !== "related_to") throw new Error("Self relation is only allowed for related_to");
  const id = clean(value.id, 500) || `content-rel:${encodeURIComponent(value.fromId)}:${value.relation}:${encodeURIComponent(value.toId)}`;
  return {
    format: CONTENT_RELATION_FORMAT,
    schemaVersion: 1,
    id,
    projectId: cleanNullable(value.projectId, 300),
    fromId: clean(value.fromId, 240),
    toId: clean(value.toId, 240),
    relation: value.relation,
    label: cleanNullable(value.label, 500),
    evidenceUri: cleanNullable(value.evidenceUri, 4_000),
    createdAt: isoOr(value.createdAt, isoOr(now, new Date().toISOString())),
    metadata: isRecord(value.metadata) ? structuredClone(value.metadata) : {},
  };
}

export function buildPromotionDraft(source: UnifiedContentObject, targetKind: ContentPromotionTarget, options: { id?: string; baseVersion?: number; projectTitle?: string; now?: string } = {}): ContentPromotion {
  if (!source.projectId) throw new Error("Promotion requires a Project-bound content object");
  const now = isoOr(options.now, new Date().toISOString());
  const evidenceUri = contentEvidenceUri(source);
  const title = clean(source.title, 500) || source.id;
  const common = { sensitivity: "internal", importance: 50, scope: source.projectId, evidenceUris: [evidenceUri] };
  let draft: Record<string, unknown>;
  if (targetKind === "decision") {
    draft = {
      project: source.projectId,
      kind: "decision",
      title: `Promote content to decision: ${title}`,
      rationale: "Created from a reviewed KV Archive content object. Human approval is required.",
      expectedImpact: "Adds a decision to Project State after evidence review.",
      riskLevel: "medium",
      evidenceUris: [evidenceUri],
      baseVersion: Math.max(0, Math.floor(Number(options.baseVersion || 0))),
      change: { action: "add", record: { id: `decision-${source.id}`, title, summary: source.body, status: "active", consequences: [], ...common } },
    };
  } else if (targetKind === "task") {
    draft = {
      project: source.projectId,
      kind: "task",
      title: `Promote content to task: ${title}`,
      rationale: "Created from a reviewed KV Archive content object. Human approval is required.",
      expectedImpact: "Adds a task to Project State after evidence review.",
      riskLevel: "low",
      evidenceUris: [evidenceUri],
      baseVersion: Math.max(0, Math.floor(Number(options.baseVersion || 0))),
      change: { action: "add", record: { id: `task-${source.id}`, title, notes: source.body, status: "todo", priority: "medium", owner: null, dueDate: null, ...common } },
    };
  } else {
    draft = {
      format: "kv-archive-memory-promotion-draft",
      schemaVersion: 1,
      projectId: source.projectId,
      projectTitle: options.projectTitle || source.projectTitle || source.projectId,
      title,
      markdown: `# ${title}\n\n${source.body}`,
      evidenceUris: [evidenceUri],
      sourceObjectId: source.id,
      sourceRevision: source.revision,
      reviewRequired: true,
    };
  }
  return {
    format: CONTENT_PROMOTION_FORMAT,
    schemaVersion: 1,
    id: clean(options.id, 500) || `content-promotion:${source.id}:${targetKind}:${now}`,
    projectId: source.projectId,
    projectTitle: options.projectTitle || source.projectTitle || source.projectId,
    sourceObjectId: source.id,
    sourceRevision: source.revision,
    sourceEvidenceUri: evidenceUri,
    targetKind,
    status: "pending_review",
    title,
    draft,
    createdAt: now,
    reviewedAt: null,
    metadata: {},
  };
}
