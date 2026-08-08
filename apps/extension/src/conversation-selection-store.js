import { CONTEXT_VAULT_STORES, openContextVaultDatabase } from "./db-schema.js";
import { createConversationSelectionSet } from "./conversation-selection.js";

const STORE = CONTEXT_VAULT_STORES.conversationSelections;

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

export function createConversationSelectionStore() {
  return {
    async put(selectionInput) {
      const selection = selectionInput?.items ? createConversationSelectionSet(selectionInput) : createConversationSelectionSet(selectionInput ?? {});
      selection.updatedAt = new Date().toISOString();
      const db = await openContextVaultDatabase("无法打开会话选择集数据库");
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(selection);
        await transactionDone(tx);
        return selection;
      } finally { db.close(); }
    },
    async get(id) {
      const db = await openContextVaultDatabase("无法打开会话选择集数据库");
      try {
        const tx = db.transaction(STORE, "readonly");
        return (await requestResult(tx.objectStore(STORE).get(id))) ?? null;
      } finally { db.close(); }
    },
    async list() {
      const db = await openContextVaultDatabase("无法打开会话选择集数据库");
      try {
        const tx = db.transaction(STORE, "readonly");
        const rows = await requestResult(tx.objectStore(STORE).getAll());
        return (rows ?? []).sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
      } finally { db.close(); }
    },
    async delete(id) {
      const db = await openContextVaultDatabase("无法打开会话选择集数据库");
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        await transactionDone(tx);
      } finally { db.close(); }
    },
  };
}
