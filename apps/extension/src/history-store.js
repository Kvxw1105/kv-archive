import { CONTEXT_VAULT_STORES, openContextVaultDatabase } from "./db-schema.js";
import { contentObjectKey, sha256HexBytes } from "./content-hash.js";
import { buildConversationStoragePlan, manifestNestedObjectKeys, manifestReferencedObjectKeys, restoreConversationFromManifest } from "./conversation-chunks.js";

const JOBS = CONTEXT_VAULT_STORES.historyJobs;
const ARTIFACTS = CONTEXT_VAULT_STORES.historyArtifacts;
const ASSETS = CONTEXT_VAULT_STORES.historyAssets;
const OBJECTS = CONTEXT_VAULT_STORES.contentObjects;

const SAFE_ASSET_FIELDS = new Set([
  "key", "jobId", "assetKey", "fileId", "fileName", "mimeType", "sizeBytes", "expectedBytes",
  "sha256", "archivePath", "bytes", "references", "diagnostics", "downloadedAt", "objectKey",
]);

function sanitizeStoredDiagnostics(value) {
  if (!value || typeof value !== "object") return null;
  const cleanMessage = (message) => String(message ?? "")
    .replace(/Bearer\s+\S+/gi, "Bearer <redacted>")
    .replace(/https?:\/\/[^\s\"'<>]+/gi, "<redacted-url>")
    .slice(0, 240);
  return {
    signingEndpoint: typeof value.signingEndpoint === "string" ? value.signingEndpoint.slice(0, 80) : null,
    signingAttempts: Array.isArray(value.signingAttempts) ? value.signingAttempts.slice(0, 10).map((attempt) => ({
      label: typeof attempt?.label === "string" ? attempt.label.slice(0, 80) : "unknown",
      result: attempt?.result === "success" ? "success" : "failed",
      status: Number.isFinite(Number(attempt?.status)) ? Number(attempt.status) : null,
      message: cleanMessage(attempt?.message),
    })) : [],
    binaryStatus: Number.isFinite(Number(value.binaryStatus)) ? Number(value.binaryStatus) : null,
    downloadHost: typeof value.downloadHost === "string" ? value.downloadHost.replace(/[^a-z0-9.:-]/gi, "").slice(0, 160) : null,
  };
}

export function sanitizeStoredAssetRecord(record) {
  if (!record || typeof record !== "object") return record;
  const clean = {};
  for (const [key, value] of Object.entries(record)) {
    if (!SAFE_ASSET_FIELDS.has(key)) continue;
    clean[key] = key === "diagnostics" ? sanitizeStoredDiagnostics(value) : value;
  }
  return clean;
}

function assetRecordNeedsSanitizing(record) {
  return Object.keys(record ?? {}).some((key) => !SAFE_ASSET_FIELDS.has(key));
}

function openDatabase() {
  return openContextVaultDatabase("无法打开本地备份数据库");
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本地数据库操作失败"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("本地数据库事务失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("本地数据库事务已取消"));
  });
}

async function putContentObjectsIfMissing(records, batchSize = 256) {
  const unique = [...new Map((records ?? []).filter((item) => item?.key).map((item) => [item.key, item])).values()];
  if (unique.length === 0) return { inserted: 0, reused: 0 };
  const db = await openDatabase();
  let inserted = 0;
  let reused = 0;
  let insertedBytes = 0;
  let reusedBytes = 0;
  const insertedByKind = {};
  const reusedByKind = {};
  try {
    const size = Math.max(1, Math.floor(Number(batchSize || 256)));
    for (let offset = 0; offset < unique.length; offset += size) {
      const batch = unique.slice(offset, offset + size);
      const readTx = db.transaction(OBJECTS, "readonly");
      const readStore = readTx.objectStore(OBJECTS);
      const existing = await Promise.all(batch.map((record) => requestResult(readStore.getKey(record.key))));
      const missing = batch.filter((_record, index) => existing[index] === undefined);
      for (let index = 0; index < batch.length; index += 1) {
        const record = batch[index];
        const kind = record.kind || "object";
        const bytes = Number(record.sizeBytes ?? 0) || 0;
        if (existing[index] === undefined) {
          insertedBytes += bytes;
          insertedByKind[kind] = Number(insertedByKind[kind] ?? 0) + 1;
        } else {
          reused += 1;
          reusedBytes += bytes;
          reusedByKind[kind] = Number(reusedByKind[kind] ?? 0) + 1;
        }
      }
      if (missing.length === 0) continue;
      const writeTx = db.transaction(OBJECTS, "readwrite");
      const writeStore = writeTx.objectStore(OBJECTS);
      for (const record of missing) writeStore.put(record);
      await transactionDone(writeTx);
      inserted += missing.length;
    }
    return { inserted, reused, insertedBytes, reusedBytes, insertedByKind, reusedByKind };
  } finally { db.close(); }
}

async function putContentObjectIfMissing(record) {
  const result = await putContentObjectsIfMissing([record]);
  return result.inserted > 0;
}

async function getContentObject(key) {
  if (!key) return null;
  const db = await openDatabase();
  try {
    const tx = db.transaction(OBJECTS, "readonly");
    return (await requestResult(tx.objectStore(OBJECTS).get(key))) ?? null;
  } finally { db.close(); }
}

async function getContentObjects(keys, batchSize = 512) {
  const unique = [...new Set((keys ?? []).filter(Boolean))];
  if (unique.length === 0) return new Map();
  const db = await openDatabase();
  const output = new Map();
  try {
    const size = Math.max(1, Math.floor(Number(batchSize || 512)));
    for (let offset = 0; offset < unique.length; offset += size) {
      const batch = unique.slice(offset, offset + size);
      const tx = db.transaction(OBJECTS, "readonly");
      const store = tx.objectStore(OBJECTS);
      const rows = await Promise.all(batch.map((key) => requestResult(store.get(key))));
      for (let index = 0; index < batch.length; index += 1) output.set(batch[index], rows[index] ?? null);
    }
    return output;
  } finally { db.close(); }
}

async function getArtifactRow(jobId, conversationId) {
  const db = await openDatabase();
  try {
    const tx = db.transaction(ARTIFACTS, "readonly");
    return (await requestResult(tx.objectStore(ARTIFACTS).get(`${jobId}:${conversationId}`))) ?? null;
  } finally { db.close(); }
}

async function getAssetRow(jobId, assetKey) {
  const db = await openDatabase();
  try {
    const tx = db.transaction(ASSETS, "readonly");
    return (await requestResult(tx.objectStore(ASSETS).get(`${jobId}:${assetKey}`))) ?? null;
  } finally { db.close(); }
}

export function createIndexedDbHistoryStore() {
  const api = {
    async getLatestJob(id) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(JOBS, "readonly");
        return (await requestResult(tx.objectStore(JOBS).get(id))) ?? null;
      } finally { db.close(); }
    },
    async saveJob(job) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(JOBS, "readwrite");
        tx.objectStore(JOBS).put(job);
        await transactionDone(tx);
      } finally { db.close(); }
    },
    async putArtifact(jobId, conversationId, artifact) {
      const raw = artifact?.raw ?? null;
      const plan = await buildConversationStoragePlan(raw);
      const storage = await putContentObjectsIfMissing(plan.records);
      const objectKey = plan.objectKey;
      const sizeBytes = plan.logicalSizeBytes;
      const { raw: _raw, ...artifactMetadata } = artifact ?? {};
      const db = await openDatabase();
      try {
        const tx = db.transaction(ARTIFACTS, "readwrite");
        tx.objectStore(ARTIFACTS).put({
          key: `${jobId}:${conversationId}`,
          jobId,
          conversationId,
          objectKey,
          sizeBytes,
          storageFormat: plan.mode,
          nodeCount: plan.nodeCount,
          artifact: artifactMetadata,
        });
        await transactionDone(tx);
      } finally { db.close(); }
      return { objectKey, sizeBytes, storageFormat: plan.mode, nodeCount: plan.nodeCount, ...storage };
    },
    async getArtifact(jobId, conversationId) {
      const row = await getArtifactRow(jobId, conversationId);
      if (!row) return null;
      if (!row.objectKey) return row.artifact ?? null;
      const object = await getContentObject(row.objectKey);
      if (!object) throw new Error(`内容对象缺失：${row.objectKey}`);
      if (object.kind !== "conversation-manifest") return { ...(row.artifact ?? {}), raw: object.payload };
      const referencedKeys = Array.isArray(object.references) && object.references.length > 0
        ? object.references
        : manifestReferencedObjectKeys(object.payload);
      const firstLevel = await getContentObjects(referencedKeys);
      for (const key of referencedKeys) if (!firstLevel.get(key)) throw new Error(`会话分块依赖内容对象缺失：${key}`);
      const nestedKeys = manifestNestedObjectKeys(object.payload, firstLevel);
      const nested = await getContentObjects(nestedKeys);
      for (const key of nestedKeys) if (!nested.get(key)) throw new Error(`会话节点内容对象缺失：${key}`);
      const referenced = new Map([...firstLevel, ...nested]);
      return { ...(row.artifact ?? {}), raw: restoreConversationFromManifest(object.payload, referenced) };
    },
    async listArtifactIds(jobId) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(ARTIFACTS, "readonly");
        const keys = await requestResult(tx.objectStore(ARTIFACTS).index("jobId").getAllKeys(IDBKeyRange.only(jobId)));
        const prefix = `${jobId}:`;
        return keys.map((key) => String(key).startsWith(prefix) ? String(key).slice(prefix.length) : String(key));
      } finally { db.close(); }
    },
    async listArtifacts(jobId) {
      const ids = await this.listArtifactIds(jobId);
      const output = [];
      for (const id of ids) {
        const artifact = await this.getArtifact(jobId, id);
        if (artifact) output.push(artifact);
      }
      return output;
    },
    async listArtifactRefs(jobId) {
      const ids = await this.listArtifactIds(jobId);
      const output = [];
      for (const conversationId of ids) {
        let row = await getArtifactRow(jobId, conversationId);
        if (!row) continue;
        if (!row.objectKey && row.artifact?.raw !== undefined) {
          await this.putArtifact(jobId, conversationId, row.artifact);
          row = await getArtifactRow(jobId, conversationId);
        }
        if (!row?.objectKey) continue;
        output.push({
          conversationId,
          objectKey: row.objectKey,
          sizeBytes: Number(row.sizeBytes ?? 0),
          title: row.artifact?.title ?? null,
          metadata: row.artifact?.metadata ?? null,
          fetchedAt: row.artifact?.fetchedAt ?? null,
        });
      }
      return output;
    },
    async putAsset(jobId, assetKey, asset) {
      const cleanInput = sanitizeStoredAssetRecord({ key: `${jobId}:${assetKey}`, jobId, assetKey, ...asset });
      const bytes = cleanInput.bytes instanceof Uint8Array ? cleanInput.bytes : Uint8Array.from(cleanInput.bytes ?? []);
      const sha256 = cleanInput.sha256 || await sha256HexBytes(bytes);
      const objectKey = await contentObjectKey("asset", bytes, sha256);
      await putContentObjectIfMissing({
        key: objectKey,
        kind: "asset",
        hash: sha256,
        sizeBytes: bytes.byteLength,
        payload: bytes,
        createdAt: new Date().toISOString(),
      });
      const { bytes: _bytes, ...metadata } = cleanInput;
      const db = await openDatabase();
      try {
        const tx = db.transaction(ASSETS, "readwrite");
        tx.objectStore(ASSETS).put({ ...metadata, sha256, objectKey, sizeBytes: bytes.byteLength });
        await transactionDone(tx);
      } finally { db.close(); }
      return { objectKey, sizeBytes: bytes.byteLength, sha256 };
    },
    async getAsset(jobId, assetKey) {
      const db = await openDatabase();
      let row;
      try {
        const tx = db.transaction(ASSETS, "readwrite");
        const store = tx.objectStore(ASSETS);
        row = (await requestResult(store.get(`${jobId}:${assetKey}`))) ?? null;
        if (!row) { await transactionDone(tx); return null; }
        const clean = sanitizeStoredAssetRecord(row);
        if (assetRecordNeedsSanitizing(row)) store.put(clean);
        await transactionDone(tx);
        row = clean;
      } finally { db.close(); }
      if (!row.objectKey) return row;
      const object = await getContentObject(row.objectKey);
      if (!object) throw new Error(`附件内容对象缺失：${row.objectKey}`);
      return { ...row, bytes: object.payload instanceof Uint8Array ? object.payload : Uint8Array.from(object.payload ?? []) };
    },
    async listAssetKeys(jobId) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(ASSETS, "readonly");
        const keys = await requestResult(tx.objectStore(ASSETS).index("jobId").getAllKeys(IDBKeyRange.only(jobId)));
        const prefix = `${jobId}:`;
        return keys.map((key) => String(key).startsWith(prefix) ? String(key).slice(prefix.length) : String(key));
      } finally { db.close(); }
    },
    async listAssets(jobId) {
      const keys = await this.listAssetKeys(jobId);
      const output = [];
      for (const key of keys) {
        const asset = await this.getAsset(jobId, key);
        if (asset) output.push(asset);
      }
      return output;
    },
    async listAssetMetadata(jobId) {
      const keys = await this.listAssetKeys(jobId);
      const output = [];
      for (const key of keys) {
        const row = await getAssetRow(jobId, key);
        if (!row) continue;
        const { bytes: _bytes, ...metadata } = sanitizeStoredAssetRecord(row);
        output.push(metadata);
      }
      return output;
    },
    async listAssetRefs(jobId) {
      const keys = await this.listAssetKeys(jobId);
      const output = [];
      for (const assetKey of keys) {
        let row = await getAssetRow(jobId, assetKey);
        if (!row) continue;
        if (!row.objectKey && row.bytes !== undefined) {
          await this.putAsset(jobId, assetKey, row);
          row = await getAssetRow(jobId, assetKey);
        }
        if (!row?.objectKey) continue;
        output.push({
          assetKey,
          objectKey: row.objectKey,
          sizeBytes: Number(row.sizeBytes ?? 0),
          fileId: row.fileId ?? null,
          fileName: row.fileName ?? null,
          mimeType: row.mimeType ?? null,
          sha256: row.sha256 ?? null,
          archivePath: row.archivePath ?? null,
          references: row.references ?? [],
        });
      }
      return output;
    },
    async listCurrentObjectKeys(jobId) {
      const [artifacts, assets] = await Promise.all([this.listArtifactRefs(jobId), this.listAssetRefs(jobId)]);
      return [...new Set([...artifacts.map((item) => item.objectKey), ...assets.map((item) => item.objectKey)])];
    },
    async deleteArtifact(jobId, conversationId) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(ARTIFACTS, "readwrite");
        tx.objectStore(ARTIFACTS).delete(`${jobId}:${conversationId}`);
        await transactionDone(tx);
      } finally { db.close(); }
    },
    async deleteAsset(jobId, assetKey) {
      const db = await openDatabase();
      try {
        const tx = db.transaction(ASSETS, "readwrite");
        tx.objectStore(ASSETS).delete(`${jobId}:${assetKey}`);
        await transactionDone(tx);
      } finally { db.close(); }
    },
    async clearJob(jobId) {
      const db = await openDatabase();
      try {
        const readArtifacts = db.transaction(ARTIFACTS, "readonly");
        const artifactKeys = await requestResult(readArtifacts.objectStore(ARTIFACTS).index("jobId").getAllKeys(IDBKeyRange.only(jobId)));
        const readAssets = db.transaction(ASSETS, "readonly");
        const assetKeys = await requestResult(readAssets.objectStore(ASSETS).index("jobId").getAllKeys(IDBKeyRange.only(jobId)));
        const writeTx = db.transaction([JOBS, ARTIFACTS, ASSETS], "readwrite");
        writeTx.objectStore(JOBS).delete(jobId);
        for (const key of artifactKeys) writeTx.objectStore(ARTIFACTS).delete(key);
        for (const key of assetKeys) writeTx.objectStore(ASSETS).delete(key);
        await transactionDone(writeTx);
      } finally { db.close(); }
    },
  };
  return api;
}
