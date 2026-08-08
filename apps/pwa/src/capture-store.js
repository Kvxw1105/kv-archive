import { CONTEXT_VAULT_STORES, openContextVaultDatabase } from "./db-schema.js";
import {
  buildPromotionDraft,
  createContentRelation,
  createContentVersion,
  normalizeContentObject,
  updateContentObject,
} from "./packages/content-contract/src/index.js";
import {
  buildImportRecoveryReceipt,
  buildRollbackRecoveryReceipt,
  planPortableCaptureImport,
  planPortableCaptureRollback,
} from "./capture-package.js";

const ITEMS = CONTEXT_VAULT_STORES.captureItems;
const VERSIONS = CONTEXT_VAULT_STORES.captureVersions;
const RELATIONS = CONTEXT_VAULT_STORES.captureRelations;
const OPERATIONS = CONTEXT_VAULT_STORES.captureOperations;
const PROMOTIONS = CONTEXT_VAULT_STORES.capturePromotions;
const RECOVERY = CONTEXT_VAULT_STORES.captureRecoveryRuns;
const RAW_OBJECTS = CONTEXT_VAULT_STORES.contentObjects;

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

function sortUpdated(rows) {
  return [...rows].sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")) || String(a.id).localeCompare(String(b.id)));
}

function makeCreateOperation(object, actor = "local-user") {
  return {
    format: "kv-archive-content-operation",
    schemaVersion: 1,
    id: `content-op:${object.id}:1:${object.createdAt}`,
    objectId: object.id,
    projectId: object.projectId,
    type: "create",
    expectedRevision: null,
    resultingRevision: object.revision,
    beforeHash: null,
    afterHash: object.contentHash,
    actor,
    createdAt: object.createdAt,
    details: { kind: object.kind },
  };
}

export function createIndexedDbCaptureStore() {
  return {
    async create(input, options = {}) {
      const object = await normalizeContentObject(input, { id: options.id, now: options.now });
      const version = createContentVersion(object, "create", object.createdAt);
      const operation = makeCreateOperation(object, options.actor);
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction([ITEMS, VERSIONS, OPERATIONS], "readwrite");
        const existing = await requestResult(tx.objectStore(ITEMS).get(object.id));
        if (existing) { tx.abort(); throw new Error(`Content object already exists: ${object.id}`); }
        tx.objectStore(ITEMS).add(object);
        tx.objectStore(VERSIONS).add(version);
        tx.objectStore(OPERATIONS).add(operation);
        await transactionDone(tx);
        return structuredClone(object);
      } finally { db.close(); }
    },

    async get(id) {
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(ITEMS, "readonly");
        return structuredClone((await requestResult(tx.objectStore(ITEMS).get(id))) ?? null);
      } finally { db.close(); }
    },

    async list(filters = {}) {
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(ITEMS, "readonly");
        let rows = filters.projectId
          ? await requestResult(tx.objectStore(ITEMS).index("projectId").getAll(IDBKeyRange.only(filters.projectId)))
          : await requestResult(tx.objectStore(ITEMS).getAll());
        if (filters.kind && filters.kind !== "all") rows = rows.filter((row) => row.kind === filters.kind);
        if (filters.status && filters.status !== "all") rows = rows.filter((row) => row.status === filters.status);
        if (filters.query) {
          const query = String(filters.query).trim().toLowerCase();
          rows = rows.filter((row) => `${row.title}\n${row.body}\n${(row.tags || []).join(" ")}`.toLowerCase().includes(query));
        }
        return sortUpdated(rows).map((row) => structuredClone(row));
      } finally { db.close(); }
    },

    async update(id, patch, options = {}) {
      const current = await this.get(id);
      if (!current) throw new Error(`Content object not found: ${id}`);
      const result = await updateContentObject(current, patch, options);
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction([ITEMS, VERSIONS, OPERATIONS], "readwrite");
        const latest = await requestResult(tx.objectStore(ITEMS).get(id));
        if (!latest || latest.revision !== current.revision || latest.contentHash !== current.contentHash) {
          tx.abort();
          throw new Error(`Content revision conflict: expected ${current.revision}, current ${latest?.revision ?? "missing"}`);
        }
        tx.objectStore(VERSIONS).add(result.version);
        tx.objectStore(ITEMS).put(result.object);
        tx.objectStore(OPERATIONS).add(result.operation);
        await transactionDone(tx);
        return structuredClone(result.object);
      } finally { db.close(); }
    },

    async trash(id, options = {}) {
      return this.update(id, { status: "trashed", trashedAt: options.now || new Date().toISOString() }, { ...options, type: "trash" });
    },

    async restore(id, options = {}) {
      return this.update(id, { status: "active", trashedAt: null, archivedAt: null }, { ...options, type: "restore" });
    },

    async archive(id, options = {}) {
      return this.update(id, { status: "archived", archivedAt: options.now || new Date().toISOString() }, { ...options, type: "archive" });
    },

    async listAllVersions(projectId = null) {
      const db = await openContextVaultDatabase();
      try {
        let rows;
        if (projectId) {
          const itemTx = db.transaction(ITEMS, "readonly");
          const objectIds = await requestResult(itemTx.objectStore(ITEMS).index("projectId").getAllKeys(IDBKeyRange.only(projectId)));
          rows = await recordsForIndexValues(db, VERSIONS, "objectId", objectIds);
        } else {
          const tx = db.transaction(VERSIONS, "readonly");
          rows = await requestResult(tx.objectStore(VERSIONS).getAll());
        }
        return rows.sort((a,b)=>String(a.objectId).localeCompare(String(b.objectId))||a.revision-b.revision).map((row)=>structuredClone(row));
      } finally { db.close(); }
    },

    async listVersions(objectId) {
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(VERSIONS, "readonly");
        const rows = await requestResult(tx.objectStore(VERSIONS).index("objectId").getAll(IDBKeyRange.only(objectId)));
        return rows.sort((a, b) => b.revision - a.revision).map((row) => structuredClone(row));
      } finally { db.close(); }
    },

    async restoreVersion(objectId, revision, options = {}) {
      const db = await openContextVaultDatabase();
      let version;
      try {
        const tx = db.transaction(VERSIONS, "readonly");
        version = await requestResult(tx.objectStore(VERSIONS).get(`${objectId}:v${revision}`));
      } finally { db.close(); }
      if (!version?.snapshot) throw new Error(`Content version not found: ${objectId}:v${revision}`);
      const snapshot = version.snapshot;
      return this.update(objectId, {
        kind: snapshot.kind,
        projectId: snapshot.projectId,
        projectTitle: snapshot.projectTitle,
        title: snapshot.title,
        body: snapshot.body,
        bodyFormat: snapshot.bodyFormat,
        summary: snapshot.summary,
        tags: snapshot.tags,
        status: snapshot.status,
        source: snapshot.source,
        attachments: snapshot.attachments,
        evidenceUris: snapshot.evidenceUris,
        archivedAt: snapshot.archivedAt,
        trashedAt: snapshot.trashedAt,
        metadata: snapshot.metadata,
      }, { ...options, type: "restore" });
    },

    async link(value, options = {}) {
      const [from, to] = await Promise.all([this.get(value.fromId), this.get(value.toId)]);
      if (!from || !to) throw new Error("Relation endpoints must exist");
      if (from.projectId && to.projectId && from.projectId !== to.projectId) throw new Error("Cross-Project relations require an explicit external-link workflow");
      const relation = createContentRelation({ ...value, projectId: value.projectId || from.projectId || to.projectId }, options.now);
      const operation = {
        format: "kv-archive-content-operation", schemaVersion: 1,
        id: `content-op:${from.id}:link:${relation.id}:${relation.createdAt}`,
        objectId: from.id, projectId: relation.projectId, type: "link",
        expectedRevision: from.revision, resultingRevision: from.revision,
        beforeHash: from.contentHash, afterHash: from.contentHash,
        actor: options.actor || "local-user", createdAt: relation.createdAt,
        details: { relationId: relation.id, relation: relation.relation, toId: relation.toId },
      };
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction([RELATIONS, OPERATIONS], "readwrite");
        tx.objectStore(RELATIONS).add(relation);
        tx.objectStore(OPERATIONS).add(operation);
        await transactionDone(tx);
        return structuredClone(relation);
      } finally { db.close(); }
    },

    async unlink(id, options = {}) {
      const db = await openContextVaultDatabase();
      try {
        const read = db.transaction(RELATIONS, "readonly");
        const relation = await requestResult(read.objectStore(RELATIONS).get(id));
        if (!relation) return false;
        const createdAt = options.now || new Date().toISOString();
        const tx = db.transaction([RELATIONS, OPERATIONS], "readwrite");
        tx.objectStore(RELATIONS).delete(id);
        tx.objectStore(OPERATIONS).add({
          format: "kv-archive-content-operation", schemaVersion: 1,
          id: `content-op:${relation.fromId}:unlink:${id}:${createdAt}`,
          objectId: relation.fromId, projectId: relation.projectId, type: "unlink",
          expectedRevision: null, resultingRevision: 0, beforeHash: null, afterHash: null,
          actor: options.actor || "local-user", createdAt,
          details: { relationId: id, relation: relation.relation, toId: relation.toId },
        });
        await transactionDone(tx);
        return true;
      } finally { db.close(); }
    },

    async listRelations(objectId = null, projectId = null) {
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(RELATIONS, "readonly");
        let rows = projectId
          ? await requestResult(tx.objectStore(RELATIONS).index("projectId").getAll(IDBKeyRange.only(projectId)))
          : await requestResult(tx.objectStore(RELATIONS).getAll());
        if (objectId) rows = rows.filter((row) => row.fromId === objectId || row.toId === objectId);
        return rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map((row) => structuredClone(row));
      } finally { db.close(); }
    },

    async listOperations(filters = {}) {
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(OPERATIONS, "readonly");
        let rows = filters.objectId
          ? await requestResult(tx.objectStore(OPERATIONS).index("objectId").getAll(IDBKeyRange.only(filters.objectId)))
          : filters.projectId
            ? await requestResult(tx.objectStore(OPERATIONS).index("projectId").getAll(IDBKeyRange.only(filters.projectId)))
            : await requestResult(tx.objectStore(OPERATIONS).getAll());
        return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((row) => structuredClone(row));
      } finally { db.close(); }
    },

    async createPromotion(sourceObjectId, targetKind, options = {}) {
      const source = await this.get(sourceObjectId);
      if (!source) throw new Error(`Content object not found: ${sourceObjectId}`);
      const promotion = buildPromotionDraft(source, targetKind, options);
      const operation = {
        format: "kv-archive-content-operation", schemaVersion: 1,
        id: `content-op:${source.id}:promote:${promotion.id}`,
        objectId: source.id, projectId: source.projectId, type: "promote",
        expectedRevision: source.revision, resultingRevision: source.revision,
        beforeHash: source.contentHash, afterHash: source.contentHash,
        actor: options.actor || "local-user", createdAt: promotion.createdAt,
        details: { promotionId: promotion.id, targetKind },
      };
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction([PROMOTIONS, OPERATIONS], "readwrite");
        tx.objectStore(PROMOTIONS).add(promotion);
        tx.objectStore(OPERATIONS).add(operation);
        await transactionDone(tx);
        return structuredClone(promotion);
      } finally { db.close(); }
    },

    async listPromotions(projectId = null) {
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(PROMOTIONS, "readonly");
        const rows = projectId
          ? await requestResult(tx.objectStore(PROMOTIONS).index("projectId").getAll(IDBKeyRange.only(projectId)))
          : await requestResult(tx.objectStore(PROMOTIONS).getAll());
        return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((row) => structuredClone(row));
      } finally { db.close(); }
    },

    async markPromotion(id, status, options = {}) {
      if (!new Set(["submitted", "applied", "rejected"]).has(status)) throw new Error("Promotion status must be submitted, applied, or rejected");
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(PROMOTIONS, "readwrite");
        const store = tx.objectStore(PROMOTIONS);
        const current = await requestResult(store.get(id));
        if (!current) throw new Error(`Promotion not found: ${id}`);
        if (current.status !== "pending_review") throw new Error(`Promotion is already ${current.status}`);
        const next = { ...current, status, reviewedAt: options.now || new Date().toISOString(), metadata: { ...(current.metadata || {}), reviewerNote: options.reviewerNote || "" } };
        store.put(next);
        await transactionDone(tx);
        return structuredClone(next);
      } finally { db.close(); }
    },

    async exportRecords(filters = {}) {
      const projectId = filters.projectId && filters.projectId !== "all" ? filters.projectId : null;
      let contentObjects = await this.list({ projectId, status: "all" });
      if (filters.unbound) contentObjects = contentObjects.filter((row) => !row.projectId);
      if (filters.dateFrom) contentObjects = contentObjects.filter((row) => Date.parse(row.updatedAt || row.createdAt || 0) >= Date.parse(`${filters.dateFrom}T00:00:00`));
      if (filters.dateTo) contentObjects = contentObjects.filter((row) => Date.parse(row.updatedAt || row.createdAt || 0) <= Date.parse(`${filters.dateTo}T23:59:59.999`));
      const ids = new Set(contentObjects.map((row) => row.id));
      const db = await openContextVaultDatabase();
      let contentVersions;
      try {
        contentVersions = await recordsForIndexValues(db, VERSIONS, "objectId", [...ids]);
      } finally { db.close(); }
      const [contentRelations, contentOperations, contentPromotions] = await Promise.all([
        this.listRelations(null, projectId),
        this.listOperations(projectId ? { projectId } : {}),
        this.listPromotions(projectId),
      ]);
      return {
        contentObjects,
        contentVersions: contentVersions.filter((row) => ids.has(row.objectId)),
        contentRelations: contentRelations.filter((row) => ids.has(row.fromId) && ids.has(row.toId)),
        contentOperations: contentOperations.filter((row) => ids.has(row.objectId)),
        contentPromotions: contentPromotions.filter((row) => ids.has(row.sourceObjectId)),
      };
    },



    async analyzePortablePackage(packageValue) {
      return planPortableCaptureImport(packageValue, await this.exportRecords({}));
    },

    async applyPortablePackage(packageValue, options = {}) {
      const plan = await this.analyzePortablePackage(packageValue);
      if (!plan.canApply) throw new Error(`Portable Capture import is blocked by ${plan.conflicts.length} conflict(s)`);
      const receipt = await buildImportRecoveryReceipt(plan, packageValue, options);
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction([ITEMS, VERSIONS, RELATIONS, OPERATIONS, PROMOTIONS, RECOVERY], "readwrite");
        const itemStore = tx.objectStore(ITEMS);
        for (const { incoming } of plan.actions.contentObjects.create) {
          if (await requestResult(itemStore.get(incoming.id))) { tx.abort(); throw new Error(`Content object appeared during import: ${incoming.id}`); }
          itemStore.add(structuredClone(incoming));
        }
        for (const { incoming, before } of plan.actions.contentObjects.fastForward) {
          const current = await requestResult(itemStore.get(incoming.id));
          if (!current || current.revision !== before.revision || current.contentHash !== before.contentHash) { tx.abort(); throw new Error(`Content object changed during import: ${incoming.id}`); }
          itemStore.put(structuredClone(incoming));
        }
        for (const { incoming } of plan.actions.contentVersions.add) tx.objectStore(VERSIONS).add(structuredClone(incoming));
        for (const { incoming } of plan.actions.contentRelations.add) tx.objectStore(RELATIONS).add(structuredClone(incoming));
        for (const { incoming } of plan.actions.contentOperations.add) tx.objectStore(OPERATIONS).add(structuredClone(incoming));
        for (const { incoming } of plan.actions.contentPromotions.add) tx.objectStore(PROMOTIONS).add(structuredClone(incoming));
        tx.objectStore(RECOVERY).add(structuredClone(receipt));
        await transactionDone(tx);
        return { plan: structuredClone(plan), receipt: structuredClone(receipt) };
      } finally { db.close(); }
    },

    async listRecoveryReceipts() {
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(RECOVERY, "readonly");
        const rows = await requestResult(tx.objectStore(RECOVERY).getAll());
        return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((row) => structuredClone(row));
      } finally { db.close(); }
    },

    async analyzePortableRollback(receiptId) {
      const receipts = await this.listRecoveryReceipts();
      const receipt = receipts.find((row) => row.id === receiptId);
      if (!receipt) throw new Error(`Recovery receipt not found: ${receiptId}`);
      return planPortableCaptureRollback(receipt, await this.exportRecords({}), receipts);
    },

    async rollbackPortableImport(receiptId, options = {}) {
      const receipts = await this.listRecoveryReceipts();
      const importReceipt = receipts.find((row) => row.id === receiptId);
      if (!importReceipt) throw new Error(`Recovery receipt not found: ${receiptId}`);
      const rollbackPlan = await planPortableCaptureRollback(importReceipt, await this.exportRecords({}), receipts);
      if (!rollbackPlan.canRollback) throw new Error(`Portable Capture rollback is blocked by ${rollbackPlan.conflicts.length} conflict(s)`);
      const rollbackReceipt = await buildRollbackRecoveryReceipt(importReceipt, rollbackPlan, options);
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction([ITEMS, VERSIONS, RELATIONS, OPERATIONS, PROMOTIONS, RECOVERY], "readwrite");
        const items = tx.objectStore(ITEMS);
        for (const { id, before } of rollbackPlan.actions.restoreObjects) {
          const boundary = importReceipt.changes.advancedObjects.find((row) => row.id === id);
          const current = await requestResult(items.get(id));
          if (!current || current.revision !== boundary.afterRevision || current.contentHash !== boundary.afterHash) { tx.abort(); throw new Error(`Rollback boundary changed: ${id}`); }
          items.put(structuredClone(before));
        }
        for (const id of rollbackPlan.actions.deleteObjectIds) {
          const boundary = importReceipt.changes.createdObjects.find((row) => row.id === id);
          const current = await requestResult(items.get(id));
          if (!current || current.revision !== boundary.afterRevision || current.contentHash !== boundary.afterHash) { tx.abort(); throw new Error(`Rollback boundary changed: ${id}`); }
          items.delete(id);
        }
        for (const key of rollbackPlan.actions.deleteVersionKeys) tx.objectStore(VERSIONS).delete(key);
        for (const id of rollbackPlan.actions.deleteRelationIds) tx.objectStore(RELATIONS).delete(id);
        for (const id of rollbackPlan.actions.deleteOperationIds) tx.objectStore(OPERATIONS).delete(id);
        for (const id of rollbackPlan.actions.deletePromotionIds) tx.objectStore(PROMOTIONS).delete(id);
        tx.objectStore(RECOVERY).add(structuredClone(rollbackReceipt));
        await transactionDone(tx);
        return { plan: structuredClone(rollbackPlan), receipt: structuredClone(rollbackReceipt) };
      } finally { db.close(); }
    },

    async listLegacyRawObjectMetadata() {
      const db = await openContextVaultDatabase();
      try {
        const tx = db.transaction(RAW_OBJECTS, "readonly");
        const rows = [];
        await new Promise((resolve, reject) => {
          const request = tx.objectStore(RAW_OBJECTS).openCursor();
          request.onerror = () => reject(request.error ?? new Error("无法读取原始内容对象"));
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return resolve();
            const { payload: _payload, ...metadata } = cursor.value || {};
            rows.push(metadata);
            cursor.continue();
          };
        });
        return rows.sort((a, b) => String(a.key).localeCompare(String(b.key)));
      } finally { db.close(); }
    },
  };
}

export function createMemoryCaptureStore() {
  const state = { items: new Map(), versions: new Map(), relations: new Map(), operations: new Map(), promotions: new Map(), recoveryRuns: new Map(), raw: new Map() };
  const api = {
    async create(input, options = {}) {
      const object = await normalizeContentObject(input, { id: options.id, now: options.now });
      if (state.items.has(object.id)) throw new Error(`Content object already exists: ${object.id}`);
      state.items.set(object.id, structuredClone(object));
      state.versions.set(`${object.id}:v1`, createContentVersion(object, "create", object.createdAt));
      const op = makeCreateOperation(object, options.actor); state.operations.set(op.id, op);
      return structuredClone(object);
    },
    async get(id) { return structuredClone(state.items.get(id) || null); },
    async list(filters = {}) {
      let rows = [...state.items.values()];
      if (filters.projectId) rows = rows.filter((row) => row.projectId === filters.projectId);
      if (filters.kind && filters.kind !== "all") rows = rows.filter((row) => row.kind === filters.kind);
      if (filters.status && filters.status !== "all") rows = rows.filter((row) => row.status === filters.status);
      return sortUpdated(rows).map((row) => structuredClone(row));
    },
    async update(id, patch, options = {}) {
      const current = state.items.get(id); if (!current) throw new Error(`Content object not found: ${id}`);
      const result = await updateContentObject(current, patch, options);
      state.versions.set(result.version.key, structuredClone(result.version));
      state.items.set(id, structuredClone(result.object));
      state.operations.set(result.operation.id, structuredClone(result.operation));
      return structuredClone(result.object);
    },
    async trash(id, options = {}) { return this.update(id, { status: "trashed", trashedAt: options.now || new Date().toISOString() }, { ...options, type: "trash" }); },
    async restore(id, options = {}) { return this.update(id, { status: "active", trashedAt: null, archivedAt: null }, { ...options, type: "restore" }); },
    async archive(id, options = {}) { return this.update(id, { status: "archived", archivedAt: options.now || new Date().toISOString() }, { ...options, type: "archive" }); },
    async listAllVersions(projectId = null) {
      return [...state.versions.values()]
        .filter((row) => !projectId || row.snapshot?.projectId === projectId)
        .sort((a, b) => String(a.objectId).localeCompare(String(b.objectId)) || Number(a.revision) - Number(b.revision))
        .map((row) => structuredClone(row));
    },
    async listVersions(id) { return [...state.versions.values()].filter((row) => row.objectId === id).sort((a, b) => b.revision - a.revision).map((row) => structuredClone(row)); },
    async restoreVersion(id, revision, options = {}) { const v=state.versions.get(`${id}:v${revision}`); if(!v)throw new Error(`Content version not found: ${id}:v${revision}`); return this.update(id, v.snapshot, { ...options, type:"restore" }); },
    async link(value, options = {}) {
      const from=state.items.get(value.fromId),to=state.items.get(value.toId);
      if(!from||!to)throw new Error("Relation endpoints must exist");
      if(from.projectId&&to.projectId&&from.projectId!==to.projectId)throw new Error("Cross-Project relations require an explicit external-link workflow");
      const relation=createContentRelation({...value,projectId:value.projectId||from.projectId||to.projectId},options.now);
      if(state.relations.has(relation.id))throw new Error(`Relation already exists: ${relation.id}`);
      state.relations.set(relation.id,relation);
      const operation={format:"kv-archive-content-operation",schemaVersion:1,id:`content-op:${from.id}:link:${relation.id}:${relation.createdAt}`,objectId:from.id,projectId:relation.projectId,type:"link",expectedRevision:from.revision,resultingRevision:from.revision,beforeHash:from.contentHash,afterHash:from.contentHash,actor:options.actor||"local-user",createdAt:relation.createdAt,details:{relationId:relation.id,relation:relation.relation,toId:relation.toId}};
      state.operations.set(operation.id,operation);
      return structuredClone(relation);
    },
    async unlink(id, options = {}) {
      const relation=state.relations.get(id);
      if(!relation)return false;
      state.relations.delete(id);
      const createdAt=options.now||new Date().toISOString();
      const operation={format:"kv-archive-content-operation",schemaVersion:1,id:`content-op:${relation.fromId}:unlink:${id}:${createdAt}`,objectId:relation.fromId,projectId:relation.projectId,type:"unlink",expectedRevision:null,resultingRevision:0,beforeHash:null,afterHash:null,actor:options.actor||"local-user",createdAt,details:{relationId:id,relation:relation.relation,toId:relation.toId}};
      state.operations.set(operation.id,operation);
      return true;
    },
    async listRelations(objectId=null,projectId=null) { return [...state.relations.values()].filter((row)=>(!projectId||row.projectId===projectId)&&(!objectId||row.fromId===objectId||row.toId===objectId)).map((row)=>structuredClone(row)); },
    async listOperations(filters={}) { return [...state.operations.values()].filter((row)=>(!filters.objectId||row.objectId===filters.objectId)&&(!filters.projectId||row.projectId===filters.projectId)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map((row)=>structuredClone(row)); },
    async createPromotion(id,target,options={}) {
      const source=state.items.get(id);
      if(!source)throw new Error(`Content object not found: ${id}`);
      const promotion=buildPromotionDraft(source,target,options);
      state.promotions.set(promotion.id,promotion);
      const operation={format:"kv-archive-content-operation",schemaVersion:1,id:`content-op:${source.id}:promote:${promotion.id}`,objectId:source.id,projectId:source.projectId,type:"promote",expectedRevision:source.revision,resultingRevision:source.revision,beforeHash:source.contentHash,afterHash:source.contentHash,actor:options.actor||"local-user",createdAt:promotion.createdAt,details:{promotionId:promotion.id,targetKind:target}};
      state.operations.set(operation.id,operation);
      return structuredClone(promotion);
    },
    async listPromotions(projectId=null) { return [...state.promotions.values()].filter((row)=>!projectId||row.projectId===projectId).map((row)=>structuredClone(row)); },
    async markPromotion(id,status,options={}) { const row=state.promotions.get(id); if(!row)throw new Error(`Promotion not found: ${id}`); if(row.status!=="pending_review"&&!(row.status==="submitted"&&["applied","rejected"].includes(status)))throw new Error(`Promotion is already ${row.status}`); const next={...row,status,reviewedAt:options.now||new Date().toISOString()}; state.promotions.set(id,next); return structuredClone(next); },
    async exportRecords(filters = {}) {
      const projectId = filters.projectId && filters.projectId !== "all" ? filters.projectId : null;
      let contentObjects = await this.list({ projectId, status: "all" });
      if (filters.unbound) contentObjects = contentObjects.filter((row) => !row.projectId);
      if (filters.dateFrom) contentObjects = contentObjects.filter((row) => Date.parse(row.updatedAt || row.createdAt || 0) >= Date.parse(`${filters.dateFrom}T00:00:00`));
      if (filters.dateTo) contentObjects = contentObjects.filter((row) => Date.parse(row.updatedAt || row.createdAt || 0) <= Date.parse(`${filters.dateTo}T23:59:59.999`));
      const ids = new Set(contentObjects.map((row) => row.id));
      const [contentVersions, contentRelations, contentOperations, contentPromotions] = await Promise.all([
        this.listAllVersions(projectId),
        this.listRelations(null, projectId),
        this.listOperations(projectId ? { projectId } : {}),
        this.listPromotions(projectId),
      ]);
      return {
        contentObjects,
        contentVersions: contentVersions.filter((row) => ids.has(row.objectId)),
        contentRelations: contentRelations.filter((row) => ids.has(row.fromId) && ids.has(row.toId)),
        contentOperations: contentOperations.filter((row) => ids.has(row.objectId)),
        contentPromotions: contentPromotions.filter((row) => ids.has(row.sourceObjectId)),
      };
    },


    async analyzePortablePackage(packageValue) { return planPortableCaptureImport(packageValue, await this.exportRecords({})); },
    async applyPortablePackage(packageValue, options = {}) {
      const plan = await this.analyzePortablePackage(packageValue);
      if (!plan.canApply) throw new Error(`Portable Capture import is blocked by ${plan.conflicts.length} conflict(s)`);
      const receipt = await buildImportRecoveryReceipt(plan, packageValue, options);
      if (state.recoveryRuns.has(receipt.id)) throw new Error(`Recovery receipt already exists: ${receipt.id}`);
      for (const { incoming } of plan.actions.contentObjects.create) state.items.set(incoming.id, structuredClone(incoming));
      for (const { incoming, before } of plan.actions.contentObjects.fastForward) {
        const current = state.items.get(incoming.id);
        if (!current || current.revision !== before.revision || current.contentHash !== before.contentHash) throw new Error(`Content object changed during import: ${incoming.id}`);
        state.items.set(incoming.id, structuredClone(incoming));
      }
      for (const { incoming } of plan.actions.contentVersions.add) state.versions.set(incoming.key, structuredClone(incoming));
      for (const { incoming } of plan.actions.contentRelations.add) state.relations.set(incoming.id, structuredClone(incoming));
      for (const { incoming } of plan.actions.contentOperations.add) state.operations.set(incoming.id, structuredClone(incoming));
      for (const { incoming } of plan.actions.contentPromotions.add) state.promotions.set(incoming.id, structuredClone(incoming));
      state.recoveryRuns.set(receipt.id, structuredClone(receipt));
      return { plan: structuredClone(plan), receipt: structuredClone(receipt) };
    },
    async listRecoveryReceipts() { return [...state.recoveryRuns.values()].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map((row)=>structuredClone(row)); },
    async analyzePortableRollback(receiptId) { const receipts=await this.listRecoveryReceipts(); const receipt=receipts.find((row)=>row.id===receiptId); if(!receipt)throw new Error(`Recovery receipt not found: ${receiptId}`); return planPortableCaptureRollback(receipt,await this.exportRecords({}),receipts); },
    async rollbackPortableImport(receiptId, options = {}) {
      const receipts=await this.listRecoveryReceipts(); const importReceipt=receipts.find((row)=>row.id===receiptId); if(!importReceipt)throw new Error(`Recovery receipt not found: ${receiptId}`);
      const plan=await planPortableCaptureRollback(importReceipt,await this.exportRecords({}),receipts); if(!plan.canRollback)throw new Error(`Portable Capture rollback is blocked by ${plan.conflicts.length} conflict(s)`);
      const receipt=await buildRollbackRecoveryReceipt(importReceipt,plan,options); if(state.recoveryRuns.has(receipt.id))throw new Error(`Recovery receipt already exists: ${receipt.id}`);
      for(const {id,before} of plan.actions.restoreObjects)state.items.set(id,structuredClone(before));
      for(const id of plan.actions.deleteObjectIds)state.items.delete(id);
      for(const key of plan.actions.deleteVersionKeys)state.versions.delete(key);
      for(const id of plan.actions.deleteRelationIds)state.relations.delete(id);
      for(const id of plan.actions.deleteOperationIds)state.operations.delete(id);
      for(const id of plan.actions.deletePromotionIds)state.promotions.delete(id);
      state.recoveryRuns.set(receipt.id,structuredClone(receipt)); return {plan:structuredClone(plan),receipt:structuredClone(receipt)};
    },
    async listLegacyRawObjectMetadata() { return [...state.raw.values()].map(({payload:_payload,...row})=>structuredClone(row)); },
    _state: state,
  };
  return api;
}
