export const CONTEXT_VAULT_DB_NAME = "kv-archive-notes";
export const CONTEXT_VAULT_DB_VERSION = 1;

export const CONTEXT_VAULT_STORES = Object.freeze({
  contentObjects: "content-objects",
  captureItems: "capture-items",
  captureVersions: "capture-versions",
  captureRelations: "capture-relations",
  captureOperations: "capture-operations",
  capturePromotions: "capture-promotions",
  captureRecoveryRuns: "capture-recovery-runs",
});

function createStoreIfMissing(db, name, options, indexes = []) {
  if (db.objectStoreNames.contains(name)) return;
  const store = db.createObjectStore(name, options);
  for (const index of indexes) store.createIndex(index.name, index.keyPath, { unique: Boolean(index.unique) });
}

export function ensureContextVaultStores(db) {
  const stores = CONTEXT_VAULT_STORES;
  createStoreIfMissing(db, stores.contentObjects, { keyPath: "key" }, [
    { name: "kind", keyPath: "kind" },
    { name: "createdAt", keyPath: "createdAt" },
  ]);
  createStoreIfMissing(db, stores.captureItems, { keyPath: "id" }, [
    { name: "projectId", keyPath: "projectId" },
    { name: "kind", keyPath: "kind" },
    { name: "status", keyPath: "status" },
    { name: "updatedAt", keyPath: "updatedAt" },
  ]);
  createStoreIfMissing(db, stores.captureVersions, { keyPath: "key" }, [
    { name: "objectId", keyPath: "objectId" },
    { name: "createdAt", keyPath: "createdAt" },
  ]);
  createStoreIfMissing(db, stores.captureRelations, { keyPath: "id" }, [
    { name: "projectId", keyPath: "projectId" },
    { name: "fromId", keyPath: "fromId" },
    { name: "toId", keyPath: "toId" },
    { name: "relation", keyPath: "relation" },
  ]);
  createStoreIfMissing(db, stores.captureOperations, { keyPath: "id" }, [
    { name: "projectId", keyPath: "projectId" },
    { name: "objectId", keyPath: "objectId" },
    { name: "createdAt", keyPath: "createdAt" },
  ]);
  createStoreIfMissing(db, stores.capturePromotions, { keyPath: "id" }, [
    { name: "projectId", keyPath: "projectId" },
    { name: "sourceObjectId", keyPath: "sourceObjectId" },
    { name: "targetKind", keyPath: "targetKind" },
    { name: "status", keyPath: "status" },
    { name: "createdAt", keyPath: "createdAt" },
  ]);
  createStoreIfMissing(db, stores.captureRecoveryRuns, { keyPath: "id" }, [
    { name: "type", keyPath: "type" },
    { name: "packageId", keyPath: "packageId" },
    { name: "sourceReceiptId", keyPath: "sourceReceiptId" },
    { name: "createdAt", keyPath: "createdAt" },
  ]);
}

export function openContextVaultDatabase(errorMessage = "无法打开 KV Archive Notes 本地数据库") {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CONTEXT_VAULT_DB_NAME, CONTEXT_VAULT_DB_VERSION);
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.onerror = () => fail(request.error ?? new Error(errorMessage));
    request.onblocked = () => setTimeout(() => fail(new Error("数据库升级被其他页面阻塞，请关闭旧页面后重试。")), 1500);
    request.onupgradeneeded = () => ensureContextVaultStores(request.result);
    request.onsuccess = () => {
      if (settled) return request.result.close();
      settled = true;
      resolve(request.result);
    };
  });
}
