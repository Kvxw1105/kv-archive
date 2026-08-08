import {
  parseContentEvidenceUri,
  sha256Content,
  stableContentStringify,
  validateContentObject,
} from "./packages/content-contract/src/index.js";
import { createStoredZip, createStoredZipBlob } from "./zip.js";
import { decodeZipText, readZipEntries } from "./zip-reader.js";

export const PORTABLE_CAPTURE_FORMAT = "kv-archive-portable-capture-package";
export const PORTABLE_CAPTURE_SCHEMA_VERSION = 1;
export const CAPTURE_RECOVERY_RECEIPT_FORMAT = "kv-archive-capture-recovery-receipt";

const COLLECTIONS = Object.freeze([
  ["contentObjects", "records/content-objects.json", "id"],
  ["contentVersions", "records/content-versions.json", "key"],
  ["contentRelations", "records/content-relations.json", "id"],
  ["contentOperations", "records/content-operations.json", "id"],
  ["contentPromotions", "records/content-promotions.json", "id"],
]);

const encoder = new TextEncoder();
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const clone = (value) => structuredClone(value);
const uniqueSuffix = () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function stableExact(value, excluded = new Set()) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => stableExact(item, excluded));
  return Object.fromEntries(Object.keys(value).sort().filter((key) => !excluded.has(key)).map((key) => [key, stableExact(value[key], excluded)]));
}

export function stableExactStringify(value, excludedKeys = []) {
  return JSON.stringify(stableExact(value, new Set(excludedKeys)));
}

export async function hashPortableRecord(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(stableExactStringify(value)));
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function sortRows(rows, key) {
  return [...(Array.isArray(rows) ? rows : [])].map(clone).sort((a, b) => String(a?.[key] ?? "").localeCompare(String(b?.[key] ?? "")));
}

export function normalizePortableRecords(records = {}) {
  return Object.fromEntries(COLLECTIONS.map(([name, _path, key]) => [name, sortRows(records[name], key)]));
}

function payloadFor(records, scope = {}) {
  return {
    format: "kv-archive-portable-capture-payload",
    schemaVersion: 1,
    scope: {
      projectId: scope.projectId || null,
      dateFrom: scope.dateFrom || null,
      dateTo: scope.dateTo || null,
      unbound: Boolean(scope.unbound),
    },
    records: normalizePortableRecords(records),
  };
}

function collectionCounts(records) {
  return Object.fromEntries(COLLECTIONS.map(([name]) => [name, records[name].length]));
}

export async function buildPortableCapturePackage(records, options = {}) {
  const payload = payloadFor(records, options.scope || {});
  const payloadHash = await hashPortableRecord(payload);
  const createdAt = options.now || new Date().toISOString();
  return {
    format: PORTABLE_CAPTURE_FORMAT,
    schemaVersion: PORTABLE_CAPTURE_SCHEMA_VERSION,
    sourceApp: "KV Archive",
    sourceAppVersion: options.sourceAppVersion || "0.16.11",
    packageId: `capture-package:${payloadHash.slice(7, 31)}`,
    createdAt,
    scope: payload.scope,
    payloadHash,
    counts: collectionCounts(payload.records),
    records: payload.records,
  };
}

function issue(severity, code, path, message) {
  return { severity, code, path, message };
}

function duplicateIssues(rows, key, path) {
  const seen = new Set();
  const issues = [];
  for (const row of rows) {
    const value = String(row?.[key] ?? "");
    if (!value) issues.push(issue("error", "MISSING_KEY", `${path}.${key}`, `Missing ${key}`));
    else if (seen.has(value)) issues.push(issue("error", "DUPLICATE_KEY", `${path}.${value}`, `Duplicate ${key}: ${value}`));
    else seen.add(value);
  }
  return issues;
}

async function validateContentHash(row, path) {
  const computed = `sha256:${await sha256Content(row)}`;
  return computed === row.contentHash ? [] : [issue("error", "CONTENT_HASH_MISMATCH", path, `Expected ${computed}, received ${row.contentHash}`)];
}

function basicRecordValidation(row, format, path) {
  const issues = [];
  if (!isRecord(row)) return [issue("error", "INVALID_RECORD", path, "Expected an object")];
  if (row.format !== format) issues.push(issue("error", "FORMAT_MISMATCH", `${path}.format`, `Expected ${format}`));
  if (row.schemaVersion !== 1) issues.push(issue("error", "SCHEMA_VERSION_MISMATCH", `${path}.schemaVersion`, "Expected schema version 1"));
  return issues;
}

function evidenceReferences(records) {
  const refs = [];
  for (const object of records.contentObjects) for (const uri of object.evidenceUris || []) refs.push({ uri, path: `contentObjects.${object.id}.evidenceUris` });
  for (const relation of records.contentRelations) if (relation.evidenceUri) refs.push({ uri: relation.evidenceUri, path: `contentRelations.${relation.id}.evidenceUri` });
  for (const promotion of records.contentPromotions) if (promotion.sourceEvidenceUri) refs.push({ uri: promotion.sourceEvidenceUri, path: `contentPromotions.${promotion.id}.sourceEvidenceUri` });
  return refs;
}

export async function validatePortableCapturePackage(value) {
  const issues = [];
  if (!isRecord(value)) return { ok: false, issues: [issue("error", "INVALID_PACKAGE", "$", "Expected an object")], errors: 1, warnings: 0 };
  if (value.format !== PORTABLE_CAPTURE_FORMAT) issues.push(issue("error", "PACKAGE_FORMAT_MISMATCH", "format", `Expected ${PORTABLE_CAPTURE_FORMAT}`));
  if (value.schemaVersion !== PORTABLE_CAPTURE_SCHEMA_VERSION) issues.push(issue("error", "PACKAGE_SCHEMA_MISMATCH", "schemaVersion", `Expected schema version ${PORTABLE_CAPTURE_SCHEMA_VERSION}`));
  const records = normalizePortableRecords(value.records || {});
  for (const [name, _path, key] of COLLECTIONS) issues.push(...duplicateIssues(records[name], key, name));

  for (const object of records.contentObjects) {
    const validation = validateContentObject(object);
    for (const row of validation.issues) issues.push(issue("error", "INVALID_CONTENT_OBJECT", `contentObjects.${object.id}.${row.path}`, row.message));
    issues.push(...await validateContentHash(object, `contentObjects.${object.id}.contentHash`));
  }

  const objectMap = new Map(records.contentObjects.map((row) => [row.id, row]));
  if (value.scope?.projectId) {
    for (const object of records.contentObjects) if (object.projectId !== value.scope.projectId) issues.push(issue("error", "SCOPE_PROJECT_MISMATCH", `contentObjects.${object.id}.projectId`, `Expected Project ${value.scope.projectId}`));
  }
  if (value.scope?.unbound) {
    for (const object of records.contentObjects) if (object.projectId) issues.push(issue("error", "SCOPE_UNBOUND_MISMATCH", `contentObjects.${object.id}.projectId`, "Unbound package contains Project-bound content"));
  }
  const versionMap = new Map();
  for (const version of records.contentVersions) {
    issues.push(...basicRecordValidation(version, "kv-archive-content-version", `contentVersions.${version.key}`));
    if (!version.objectId || !Number.isInteger(version.revision) || version.revision < 1 || !isRecord(version.snapshot)) {
      issues.push(issue("error", "INVALID_CONTENT_VERSION", `contentVersions.${version.key}`, "Version requires objectId, positive revision and snapshot"));
      continue;
    }
    const validation = validateContentObject(version.snapshot);
    for (const row of validation.issues) issues.push(issue("error", "INVALID_VERSION_SNAPSHOT", `contentVersions.${version.key}.snapshot.${row.path}`, row.message));
    issues.push(...await validateContentHash(version.snapshot, `contentVersions.${version.key}.snapshot.contentHash`));
    if (version.snapshot.id !== version.objectId || version.snapshot.revision !== version.revision || version.snapshotHash !== version.snapshot.contentHash || version.key !== `${version.objectId}:v${version.revision}`) {
      issues.push(issue("error", "VERSION_IDENTITY_MISMATCH", `contentVersions.${version.key}`, "Version key, object id, revision and snapshot hash must agree"));
    }
    versionMap.set(`${version.objectId}:v${version.revision}`, version);
  }

  for (const object of records.contentObjects) {
    const currentVersion = versionMap.get(`${object.id}:v${object.revision}`);
    if (!currentVersion || currentVersion.snapshotHash !== object.contentHash) issues.push(issue("error", "CURRENT_VERSION_MISSING", `contentObjects.${object.id}`, "Current object revision is not backed by an identical immutable version"));
  }

  for (const relation of records.contentRelations) {
    issues.push(...basicRecordValidation(relation, "kv-archive-content-relation", `contentRelations.${relation.id}`));
    if (!objectMap.has(relation.fromId) || !objectMap.has(relation.toId)) issues.push(issue("error", "RELATION_ENDPOINT_MISSING", `contentRelations.${relation.id}`, "Both relation endpoints must exist in the package"));
    const from = objectMap.get(relation.fromId); const to = objectMap.get(relation.toId);
    if (from?.projectId && to?.projectId && from.projectId !== to.projectId) issues.push(issue("error", "CROSS_PROJECT_RELATION", `contentRelations.${relation.id}`, "Implicit cross-Project relation is not portable"));
  }
  for (const operation of records.contentOperations) {
    issues.push(...basicRecordValidation(operation, "kv-archive-content-operation", `contentOperations.${operation.id}`));
    if (!objectMap.has(operation.objectId)) issues.push(issue("error", "OPERATION_OBJECT_MISSING", `contentOperations.${operation.id}`, "Operation object must exist in the package"));
  }
  for (const promotion of records.contentPromotions) {
    issues.push(...basicRecordValidation(promotion, "kv-archive-content-promotion", `contentPromotions.${promotion.id}`));
    const source = objectMap.get(promotion.sourceObjectId);
    if (!source) issues.push(issue("error", "PROMOTION_SOURCE_MISSING", `contentPromotions.${promotion.id}`, "Promotion source must exist in the package"));
    else if (promotion.sourceRevision > source.revision) issues.push(issue("error", "PROMOTION_REVISION_INVALID", `contentPromotions.${promotion.id}`, "Promotion source revision is newer than the packaged object"));
  }

  for (const ref of evidenceReferences(records)) {
    const parsed = parseContentEvidenceUri(ref.uri);
    if (!parsed) continue;
    const version = versionMap.get(`${parsed.objectId}:v${parsed.revision}`);
    if (!version) issues.push(issue("warning", "EXTERNAL_CONTENT_EVIDENCE", ref.path, `Referenced content version is not included: ${parsed.objectId}:v${parsed.revision}`));
    else if (version.snapshotHash !== parsed.contentHash) issues.push(issue("error", "EVIDENCE_HASH_MISMATCH", ref.path, `Evidence URI hash does not match ${parsed.objectId}:v${parsed.revision}`));
  }

  const expectedPayloadHash = await hashPortableRecord(payloadFor(records, value.scope || {}));
  if (value.payloadHash !== expectedPayloadHash) issues.push(issue("error", "PAYLOAD_HASH_MISMATCH", "payloadHash", `Expected ${expectedPayloadHash}`));
  if (value.packageId !== `capture-package:${expectedPayloadHash.slice(7, 31)}`) issues.push(issue("error", "PACKAGE_ID_MISMATCH", "packageId", "Package id does not match payload hash"));
  const expectedCounts = collectionCounts(records);
  for (const [name, count] of Object.entries(expectedCounts)) if (Number(value.counts?.[name]) !== count) issues.push(issue("error", "COUNT_MISMATCH", `counts.${name}`, `Expected ${count}`));
  const errors = issues.filter((row) => row.severity === "error").length;
  const warnings = issues.length - errors;
  return { ok: errors === 0, issues, errors, warnings, records, expectedPayloadHash };
}

export function portableCaptureEntries(packageValue) {
  const manifest = { ...clone(packageValue) };
  delete manifest.records;
  return [
    { name: "manifest.json", data: JSON.stringify(manifest, null, 2) + "\n" },
    ...COLLECTIONS.map(([name, path]) => ({ name: path, data: JSON.stringify(packageValue.records?.[name] || [], null, 2) + "\n" })),
    { name: "README.md", data: "# KV Archive Portable Capture Package\n\nThis package contains editable capture records only. It does not contain raw conversation evidence, authentication data, approved Project State, or binary attachments. Always run a dry-run import before applying recovery.\n" },
  ];
}

export function createPortableCaptureZip(packageValue, date = new Date(packageValue.createdAt || Date.now())) {
  return createStoredZip(portableCaptureEntries(packageValue), date);
}

export function createPortableCaptureZipBlob(packageValue, date = new Date(packageValue.createdAt || Date.now())) {
  return createStoredZipBlob(portableCaptureEntries(packageValue), date);
}

export async function readPortableCaptureZip(input) {
  const entries = await readZipEntries(input, { maxEntries: 100, maxUncompressedBytes: 512 * 1024 * 1024 });
  const manifestBytes = entries.get("manifest.json");
  if (!manifestBytes) throw new Error("Portable Capture package is missing manifest.json");
  const manifest = JSON.parse(decodeZipText(manifestBytes));
  const records = {};
  for (const [name, path] of COLLECTIONS) {
    const bytes = entries.get(path);
    if (!bytes) throw new Error(`Portable Capture package is missing ${path}`);
    const parsed = JSON.parse(decodeZipText(bytes));
    if (!Array.isArray(parsed)) throw new Error(`Portable Capture record file must contain an array: ${path}`);
    records[name] = parsed;
  }
  const packageValue = { ...manifest, records };
  const validation = await validatePortableCapturePackage(packageValue);
  if (!validation.ok) throw new Error(`Portable Capture package validation failed: ${validation.issues.filter((row) => row.severity === "error").slice(0, 3).map((row) => `${row.code} ${row.path}`).join("; ")}`);
  return { package: packageValue, validation };
}

async function equalRecords(a, b) {
  return stableExactStringify(a) === stableExactStringify(b);
}

function mapBy(rows, key) { return new Map((rows || []).map((row) => [row[key], row])); }
function actionBucket() { return { create: [], fastForward: [], add: [], skip: [], conflicts: [] }; }
function conflict(code, collection, id, message, details = {}) { return { code, collection, id, message, details }; }

export async function planPortableCaptureImport(packageValue, localRecords = {}) {
  const validation = await validatePortableCapturePackage(packageValue);
  const incoming = validation.records || normalizePortableRecords(packageValue.records || {});
  const local = normalizePortableRecords(localRecords);
  const actions = {
    contentObjects: actionBucket(), contentVersions: actionBucket(), contentRelations: actionBucket(),
    contentOperations: actionBucket(), contentPromotions: actionBucket(),
  };
  const localObjects = mapBy(local.contentObjects, "id");
  const localVersions = mapBy(local.contentVersions, "key");
  const incomingVersions = mapBy(incoming.contentVersions, "key");

  for (const row of incoming.contentObjects) {
    const current = localObjects.get(row.id);
    if (!current) { actions.contentObjects.create.push({ incoming: row }); continue; }
    if ((current.projectId || null) !== (row.projectId || null)) {
      actions.contentObjects.conflicts.push(conflict("PROJECT_CONFLICT", "contentObjects", row.id, "The same content id belongs to a different Project", { localProjectId: current.projectId, incomingProjectId: row.projectId }));
      continue;
    }
    if (current.revision === row.revision && current.contentHash === row.contentHash) { actions.contentObjects.skip.push({ incoming: row, local: current, reason: "identical" }); continue; }
    if (row.revision > current.revision) {
      const ancestor = incomingVersions.get(`${row.id}:v${current.revision}`);
      if (ancestor?.snapshotHash === current.contentHash) actions.contentObjects.fastForward.push({ incoming: row, before: current, ancestorRevision: current.revision });
      else actions.contentObjects.conflicts.push(conflict("DIVERGENT_HISTORY", "contentObjects", row.id, "Incoming history does not contain the current local revision", { localRevision: current.revision, incomingRevision: row.revision }));
      continue;
    }
    if (current.revision > row.revision) {
      const localAncestor = localVersions.get(`${row.id}:v${row.revision}`);
      if (localAncestor?.snapshotHash === row.contentHash) actions.contentObjects.skip.push({ incoming: row, local: current, reason: "local-ahead" });
      else actions.contentObjects.conflicts.push(conflict("DIVERGENT_HISTORY", "contentObjects", row.id, "Local history does not contain the incoming revision", { localRevision: current.revision, incomingRevision: row.revision }));
      continue;
    }
    actions.contentObjects.conflicts.push(conflict("REVISION_HASH_CONFLICT", "contentObjects", row.id, "Same revision has a different content hash", { revision: row.revision, localHash: current.contentHash, incomingHash: row.contentHash }));
  }

  for (const [name, _path, key] of COLLECTIONS.slice(1)) {
    const localMap = mapBy(local[name], key);
    for (const row of incoming[name]) {
      const current = localMap.get(row[key]);
      if (!current) actions[name].add.push({ incoming: row, recordHash: await hashPortableRecord(row) });
      else if (await equalRecords(current, row)) actions[name].skip.push({ incoming: row, local: current, reason: "identical" });
      else actions[name].conflicts.push(conflict("RECORD_ID_CONFLICT", name, row[key], "The same immutable record id has different content"));
    }
  }

  const eventualObjectIds = new Set([...local.contentObjects.map((row) => row.id), ...actions.contentObjects.create.map((row) => row.incoming.id)]);
  for (const row of actions.contentRelations.add) {
    if (!eventualObjectIds.has(row.incoming.fromId) || !eventualObjectIds.has(row.incoming.toId)) {
      actions.contentRelations.conflicts.push(conflict("RELATION_ENDPOINT_UNAVAILABLE", "contentRelations", row.incoming.id, "Relation endpoint will not exist after import"));
      actions.contentRelations.add = actions.contentRelations.add.filter((item) => item !== row);
    }
  }

  const conflicts = [...validation.issues.filter((row) => row.severity === "error").map((row) => conflict(row.code, "package", row.path, row.message)), ...Object.values(actions).flatMap((bucket) => bucket.conflicts)];
  const writeCounts = {
    createObjects: actions.contentObjects.create.length,
    fastForwardObjects: actions.contentObjects.fastForward.length,
    addVersions: actions.contentVersions.add.length,
    addRelations: actions.contentRelations.add.length,
    addOperations: actions.contentOperations.add.length,
    addPromotions: actions.contentPromotions.add.length,
  };
  const totalWrites = Object.values(writeCounts).reduce((sum, value) => sum + value, 0);
  const planCore = { packageId: packageValue.packageId, payloadHash: packageValue.payloadHash, validation: { ok: validation.ok, errors: validation.errors, warnings: validation.warnings, issues: validation.issues }, actions, conflicts, writeCounts, totalWrites, canApply: conflicts.length === 0 };
  return { ...planCore, planHash: await hashPortableRecord({ ...planCore, actions: Object.fromEntries(Object.entries(actions).map(([name, bucket]) => [name, { ...bucket, create: bucket.create.map((row) => row.incoming?.id), fastForward: bucket.fastForward.map((row) => row.incoming?.id), add: bucket.add.map((row) => row.incoming?.id || row.incoming?.key), skip: bucket.skip.map((row) => row.incoming?.id || row.incoming?.key) }])) }) };
}

export async function buildImportRecoveryReceipt(plan, packageValue, options = {}) {
  const createdAt = options.now || new Date().toISOString();
  const changes = {
    createdObjects: plan.actions.contentObjects.create.map(({ incoming }) => ({ id: incoming.id, afterRevision: incoming.revision, afterHash: incoming.contentHash })),
    advancedObjects: plan.actions.contentObjects.fastForward.map(({ incoming, before }) => ({ id: incoming.id, before: clone(before), afterRevision: incoming.revision, afterHash: incoming.contentHash })),
    addedVersions: plan.actions.contentVersions.add.map(({ incoming, recordHash }) => ({ key: incoming.key, recordHash })),
    addedRelations: plan.actions.contentRelations.add.map(({ incoming, recordHash }) => ({ id: incoming.id, recordHash })),
    addedOperations: plan.actions.contentOperations.add.map(({ incoming, recordHash }) => ({ id: incoming.id, recordHash })),
    addedPromotions: plan.actions.contentPromotions.add.map(({ incoming, recordHash }) => ({ id: incoming.id, recordHash })),
  };
  const base = {
    format: CAPTURE_RECOVERY_RECEIPT_FORMAT, schemaVersion: 1,
    id: options.id || `capture-recovery:${createdAt}:${packageValue.payloadHash.slice(7, 19)}:${uniqueSuffix()}`,
    type: "import", status: plan.totalWrites ? "applied" : "no_changes",
    packageId: packageValue.packageId, payloadHash: packageValue.payloadHash,
    sourceReceiptId: null, createdAt, actor: options.actor || "local-user",
    planHash: plan.planHash, summary: clone(plan.writeCounts), changes,
    rollbackBoundary: "Rollback only removes records added by this receipt and restores fast-forwarded current objects when no later local change or dependent relation exists.",
  };
  return { ...base, receiptHash: await hashPortableRecord(base) };
}

export async function planPortableCaptureRollback(receipt, localRecords, receipts = []) {
  const conflicts = [];
  if (!isRecord(receipt) || receipt.format !== CAPTURE_RECOVERY_RECEIPT_FORMAT || receipt.type !== "import") conflicts.push(conflict("INVALID_RECEIPT", "receipt", receipt?.id || "unknown", "Only an import recovery receipt can be rolled back"));
  if (receipts.some((row) => row.type === "rollback" && row.sourceReceiptId === receipt.id && row.status === "applied")) conflicts.push(conflict("ALREADY_ROLLED_BACK", "receipt", receipt.id, "This import receipt already has an applied rollback receipt"));
  const local = normalizePortableRecords(localRecords);
  const objects = mapBy(local.contentObjects, "id");
  const versions = mapBy(local.contentVersions, "key");
  const relations = mapBy(local.contentRelations, "id");
  const operations = mapBy(local.contentOperations, "id");
  const promotions = mapBy(local.contentPromotions, "id");
  const expectedRelationIds = new Set((receipt.changes?.addedRelations || []).map((row) => row.id));
  const expectedOperationIds = new Set((receipt.changes?.addedOperations || []).map((row) => row.id));
  const expectedPromotionIds = new Set((receipt.changes?.addedPromotions || []).map((row) => row.id));
  const receiptTime = Date.parse(receipt.createdAt || 0);

  for (const row of receipt.changes?.createdObjects || []) {
    const current = objects.get(row.id);
    if (!current || current.revision !== row.afterRevision || current.contentHash !== row.afterHash) conflicts.push(conflict("OBJECT_CHANGED_AFTER_IMPORT", "contentObjects", row.id, "Created object no longer matches the imported boundary"));
    const foreignRelations = local.contentRelations.filter((relation) => (relation.fromId === row.id || relation.toId === row.id) && !expectedRelationIds.has(relation.id));
    if (foreignRelations.length) conflicts.push(conflict("DEPENDENT_RELATION_EXISTS", "contentObjects", row.id, "New local relations depend on an object created by the import", { relationIds: foreignRelations.map((item) => item.id) }));
    const foreignOperations = local.contentOperations.filter((operation) => operation.objectId === row.id && !expectedOperationIds.has(operation.id));
    if (foreignOperations.length) conflicts.push(conflict("DEPENDENT_OPERATION_EXISTS", "contentObjects", row.id, "New local operations depend on an object created by the import", { operationIds: foreignOperations.map((item) => item.id) }));
    const foreignPromotions = local.contentPromotions.filter((promotion) => promotion.sourceObjectId === row.id && !expectedPromotionIds.has(promotion.id));
    if (foreignPromotions.length) conflicts.push(conflict("DEPENDENT_PROMOTION_EXISTS", "contentObjects", row.id, "New local promotion drafts depend on an object created by the import", { promotionIds: foreignPromotions.map((item) => item.id) }));
  }
  for (const row of receipt.changes?.advancedObjects || []) {
    const current = objects.get(row.id);
    if (!current || current.revision !== row.afterRevision || current.contentHash !== row.afterHash) conflicts.push(conflict("OBJECT_CHANGED_AFTER_IMPORT", "contentObjects", row.id, "Fast-forwarded object has changed since import"));
    const laterOperations = local.contentOperations.filter((operation) => operation.objectId === row.id && !expectedOperationIds.has(operation.id) && Date.parse(operation.createdAt || 0) >= receiptTime);
    if (laterOperations.length) conflicts.push(conflict("POST_IMPORT_OPERATION_EXISTS", "contentObjects", row.id, "Later local operations depend on the fast-forwarded revision", { operationIds: laterOperations.map((item) => item.id) }));
    const laterPromotions = local.contentPromotions.filter((promotion) => promotion.sourceObjectId === row.id && !expectedPromotionIds.has(promotion.id) && Date.parse(promotion.createdAt || 0) >= receiptTime);
    if (laterPromotions.length) conflicts.push(conflict("POST_IMPORT_PROMOTION_EXISTS", "contentObjects", row.id, "Later promotion drafts depend on the fast-forwarded revision", { promotionIds: laterPromotions.map((item) => item.id) }));
  }
  for (const [rows, map, keyName, collection] of [
    [receipt.changes?.addedVersions || [], versions, "key", "contentVersions"],
    [receipt.changes?.addedRelations || [], relations, "id", "contentRelations"],
    [receipt.changes?.addedOperations || [], operations, "id", "contentOperations"],
    [receipt.changes?.addedPromotions || [], promotions, "id", "contentPromotions"],
  ]) {
    for (const row of rows) {
      const current = map.get(row[keyName]);
      if (!current) conflicts.push(conflict("IMPORTED_RECORD_MISSING", collection, row[keyName], "Imported record is already missing"));
      else if (await hashPortableRecord(current) !== row.recordHash) conflicts.push(conflict("IMPORTED_RECORD_CHANGED", collection, row[keyName], "Imported record changed after recovery"));
    }
  }
  const actions = {
    deleteObjectIds: (receipt.changes?.createdObjects || []).map((row) => row.id),
    restoreObjects: (receipt.changes?.advancedObjects || []).map((row) => ({ id: row.id, before: clone(row.before) })),
    deleteVersionKeys: (receipt.changes?.addedVersions || []).map((row) => row.key),
    deleteRelationIds: (receipt.changes?.addedRelations || []).map((row) => row.id),
    deleteOperationIds: (receipt.changes?.addedOperations || []).map((row) => row.id),
    deletePromotionIds: (receipt.changes?.addedPromotions || []).map((row) => row.id),
  };
  return { receiptId: receipt.id, canRollback: conflicts.length === 0, conflicts, actions, rollbackHash: await hashPortableRecord({ receiptId: receipt.id, actions, conflicts }) };
}

export async function buildRollbackRecoveryReceipt(importReceipt, rollbackPlan, options = {}) {
  const createdAt = options.now || new Date().toISOString();
  const base = {
    format: CAPTURE_RECOVERY_RECEIPT_FORMAT, schemaVersion: 1,
    id: options.id || `capture-recovery-rollback:${createdAt}:${importReceipt.payloadHash.slice(7, 19)}:${uniqueSuffix()}`,
    type: "rollback", status: "applied", packageId: importReceipt.packageId, payloadHash: importReceipt.payloadHash,
    sourceReceiptId: importReceipt.id, createdAt, actor: options.actor || "local-user",
    planHash: rollbackPlan.rollbackHash,
    summary: {
      deletedObjects: rollbackPlan.actions.deleteObjectIds.length,
      restoredObjects: rollbackPlan.actions.restoreObjects.length,
      deletedVersions: rollbackPlan.actions.deleteVersionKeys.length,
      deletedRelations: rollbackPlan.actions.deleteRelationIds.length,
      deletedOperations: rollbackPlan.actions.deleteOperationIds.length,
      deletedPromotions: rollbackPlan.actions.deletePromotionIds.length,
    },
    changes: clone(rollbackPlan.actions), rollbackBoundary: "Append-only rollback receipt. The original import receipt is retained unchanged.",
  };
  return { ...base, receiptHash: await hashPortableRecord(base) };
}
