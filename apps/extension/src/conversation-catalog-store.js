import { CONTEXT_VAULT_STORES, openContextVaultDatabase } from "./db-schema.js";

const STORE = CONTEXT_VAULT_STORES.conversationCatalogs;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function cacheKey(provider, accountScopeId) {
  return `${String(provider || "generic-web-chat")}:${String(accountScopeId || "personal")}`;
}

function normalizeCatalogRecord(catalog, cachedAt = new Date().toISOString()) {
  if (!catalog || !Array.isArray(catalog.conversations)) throw new Error("Conversation catalog is invalid");
  const provider = String(catalog.provider || "generic-web-chat");
  const accountScopeId = catalog.accountScopeId || null;
  return {
    key: cacheKey(provider, accountScopeId),
    provider,
    accountScopeId,
    accountScopeLabel: catalog.accountScopeLabel || "当前空间",
    cachedAt,
    conversationCount: catalog.conversations.length,
    collectionCount: Array.isArray(catalog.collections) ? catalog.collections.length : 0,
    catalog: structuredClone(catalog),
  };
}

export function createConversationCatalogStore() {
  return {
    async put(catalog) {
      const record = normalizeCatalogRecord(catalog);
      const db = await openContextVaultDatabase("无法打开会话目录缓存数据库");
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(record);
        await transactionDone(tx);
        return structuredClone(record);
      } finally { db.close(); }
    },
    async get(provider, accountScopeId = null) {
      const db = await openContextVaultDatabase("无法打开会话目录缓存数据库");
      try {
        const tx = db.transaction(STORE, "readonly");
        return (await requestResult(tx.objectStore(STORE).get(cacheKey(provider, accountScopeId)))) ?? null;
      } finally { db.close(); }
    },
    async list(provider = null) {
      const db = await openContextVaultDatabase("无法打开会话目录缓存数据库");
      try {
        const tx = db.transaction(STORE, "readonly");
        const rows = (await requestResult(tx.objectStore(STORE).getAll())) ?? [];
        return rows
          .filter((row) => !provider || row.provider === provider)
          .sort((a, b) => String(b.cachedAt || "").localeCompare(String(a.cachedAt || "")));
      } finally { db.close(); }
    },
    async getLatest(provider = null) {
      return (await this.list(provider))[0] ?? null;
    },
    async delete(provider, accountScopeId = null) {
      const db = await openContextVaultDatabase("无法打开会话目录缓存数据库");
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(cacheKey(provider, accountScopeId));
        await transactionDone(tx);
      } finally { db.close(); }
    },
  };
}

export function createMemoryConversationCatalogStore() {
  const rows = new Map();
  return {
    async put(catalog) {
      const record = normalizeCatalogRecord(catalog);
      rows.set(record.key, structuredClone(record));
      return structuredClone(record);
    },
    async get(provider, accountScopeId = null) {
      return structuredClone(rows.get(cacheKey(provider, accountScopeId)) || null);
    },
    async list(provider = null) {
      return [...rows.values()]
        .filter((row) => !provider || row.provider === provider)
        .sort((a, b) => String(b.cachedAt || "").localeCompare(String(a.cachedAt || "")))
        .map((row) => structuredClone(row));
    },
    async getLatest(provider = null) { return (await this.list(provider))[0] ?? null; },
    async delete(provider, accountScopeId = null) { rows.delete(cacheKey(provider, accountScopeId)); },
  };
}
