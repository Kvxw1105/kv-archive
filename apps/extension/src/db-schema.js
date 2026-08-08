export const CONTEXT_VAULT_DB_NAME = "context-vault";
export const CONTEXT_VAULT_DB_VERSION = 13;

export const CONTEXT_VAULT_STORES = Object.freeze({
  historyJobs: "history-jobs",
  historyArtifacts: "history-artifacts",
  historyAssets: "history-assets",
  vaultImports: "vault-imports",
  vaultConversations: "vault-conversations",
  vaultEvidence: "vault-evidence",
  vaultMessages: "vault-messages",
  vaultPostings: "vault-postings",
  stateProjects: "state-projects",
  stateVersions: "state-versions",
  stateProposals: "state-proposals",
  stateEvents: "state-events",
  contentObjects: "content-objects",
  captureItems: "capture-items",
  captureVersions: "capture-versions",
  captureRelations: "capture-relations",
  captureOperations: "capture-operations",
  capturePromotions: "capture-promotions",
  captureRecoveryRuns: "capture-recovery-runs",
  snapshots: "snapshots",
  scheduler: "scheduler",
  schedulerRuns: "scheduler-runs",
  memoryProfiles: "memory-profiles",
  memoryVersions: "memory-versions",
  memoryEvents: "memory-events",
  memoryGateConfigs: "memory-gate-configs",
  memoryGateRuns: "memory-gate-runs",
  knowledgeExportProfiles: "knowledge-export-profiles",
  knowledgeExportPaths: "knowledge-export-paths",
  knowledgeExportRuns: "knowledge-export-runs",
  conversationSelections: "conversation-selections",
  conversationCatalogs: "conversation-catalogs",
});

function createStoreIfMissing(db, name, options, indexes = []) {
  if (db.objectStoreNames.contains(name)) return;
  const store = db.createObjectStore(name, options);
  for (const index of indexes) {
    store.createIndex(index.name, index.keyPath, { unique: Boolean(index.unique) });
  }
}

/**
 * Creates every store used by every ContextVault surface. Keeping this in one
 * module prevents a backup page from requesting an older IndexedDB version
 * than the library or state pages.
 */
export function ensureContextVaultStores(db) {
  const stores = CONTEXT_VAULT_STORES;
  createStoreIfMissing(db, stores.historyJobs, { keyPath: "id" });
  createStoreIfMissing(db, stores.historyArtifacts, { keyPath: "key" }, [
    { name: "jobId", keyPath: "jobId" },
  ]);
  createStoreIfMissing(db, stores.historyAssets, { keyPath: "key" }, [
    { name: "jobId", keyPath: "jobId" },
    { name: "assetKey", keyPath: "assetKey" },
  ]);
  createStoreIfMissing(db, stores.vaultImports, { keyPath: "id" }, [
    { name: "importedAt", keyPath: "importedAt" },
  ]);
  createStoreIfMissing(db, stores.vaultConversations, { keyPath: "key" }, [
    { name: "updatedAt", keyPath: "updatedAt" },
    { name: "projectId", keyPath: "projectId" },
  ]);
  createStoreIfMissing(db, stores.vaultEvidence, { keyPath: "key" }, [
    { name: "conversationKey", keyPath: "conversationKey" },
  ]);
  createStoreIfMissing(db, stores.vaultMessages, { keyPath: "key" }, [
    { name: "conversationKey", keyPath: "conversationKey" },
    { name: "role", keyPath: "role" },
  ]);
  createStoreIfMissing(db, stores.vaultPostings, { keyPath: "key" }, [
    { name: "token", keyPath: "token" },
    { name: "conversationKey", keyPath: "conversationKey" },
  ]);
  createStoreIfMissing(db, stores.stateProjects, { keyPath: "projectId" }, [
    { name: "updatedAt", keyPath: "updatedAt" },
  ]);
  createStoreIfMissing(db, stores.stateVersions, { keyPath: "key" }, [
    { name: "projectId", keyPath: "projectId" },
    { name: "createdAt", keyPath: "createdAt" },
  ]);
  createStoreIfMissing(db, stores.stateProposals, { keyPath: "id" }, [
    { name: "projectId", keyPath: "projectId" },
    { name: "status", keyPath: "status" },
    { name: "createdAt", keyPath: "createdAt" },
  ]);
  createStoreIfMissing(db, stores.stateEvents, { keyPath: "id" }, [
    { name: "projectId", keyPath: "projectId" },
    { name: "proposalId", keyPath: "proposalId" },
    { name: "createdAt", keyPath: "createdAt" },
  ]);
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
  createStoreIfMissing(db, stores.snapshots, { keyPath: "id" }, [
    { name: "jobId", keyPath: "jobId" },
    { name: "accountKey", keyPath: "accountKey" },
    { name: "fingerprint", keyPath: "fingerprint" },
    { name: "createdAt", keyPath: "createdAt" },
  ]);
  createStoreIfMissing(db, stores.scheduler, { keyPath: "id" });
  createStoreIfMissing(db, stores.schedulerRuns, { keyPath: "id" }, [
    { name: "status", keyPath: "status" },
    { name: "startedAt", keyPath: "startedAt" },
  ]);
  createStoreIfMissing(db, stores.memoryProfiles, { keyPath: "projectId" }, [
    { name: "approvedAt", keyPath: "approvedAt" },
  ]);
  createStoreIfMissing(db, stores.memoryVersions, { keyPath: "key" }, [
    { name: "projectId", keyPath: "projectId" },
    { name: "approvedAt", keyPath: "approvedAt" },
  ]);
  createStoreIfMissing(db, stores.memoryEvents, { keyPath: "id" }, [
    { name: "projectId", keyPath: "projectId" },
    { name: "createdAt", keyPath: "createdAt" },
  ]);
  createStoreIfMissing(db, stores.memoryGateConfigs, { keyPath: "projectId" }, [
    { name: "updatedAt", keyPath: "updatedAt" },
  ]);
  createStoreIfMissing(db, stores.memoryGateRuns, { keyPath: "id" }, [
    { name: "projectId", keyPath: "projectId" },
    { name: "createdAt", keyPath: "createdAt" },
  ]);
  createStoreIfMissing(db, stores.knowledgeExportProfiles, { keyPath: "projectId" }, [
    { name: "updatedAt", keyPath: "updatedAt" },
  ]);
  createStoreIfMissing(db, stores.knowledgeExportPaths, { keyPath: "key" }, [
    { name: "projectId", keyPath: "projectId" },
    { name: "nodeId", keyPath: "nodeId" },
  ]);
  createStoreIfMissing(db, stores.knowledgeExportRuns, { keyPath: "id" }, [
    { name: "projectId", keyPath: "projectId" },
    { name: "status", keyPath: "status" },
    { name: "updatedAt", keyPath: "updatedAt" },
  ]);
  createStoreIfMissing(db, stores.conversationSelections, { keyPath: "id" }, [
    { name: "updatedAt", keyPath: "updatedAt" },
    { name: "provider", keyPath: "provider" },
  ]);
  createStoreIfMissing(db, stores.conversationCatalogs, { keyPath: "key" }, [
    { name: "provider", keyPath: "provider" },
    { name: "cachedAt", keyPath: "cachedAt" },
  ]);
}

export function openContextVaultDatabase(errorMessage = "无法打开 KV Archive 本地数据库") {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CONTEXT_VAULT_DB_NAME, CONTEXT_VAULT_DB_VERSION);
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.onerror = () => {
      const error = request.error;
      if (error?.name === "VersionError") {
        fail(new Error("本地数据库版本高于当前插件版本。请安装最新版 KV Archive 后重新加载扩展。"));
        return;
      }
      fail(error ?? new Error(errorMessage));
    };
    request.onblocked = () => {
      setTimeout(() => fail(new Error("数据库升级被其他已打开的 KV Archive 页面阻塞。请关闭旧的备份、资料库或状态中心页面后重试。")), 1500);
    };
    request.onupgradeneeded = () => ensureContextVaultStores(request.result);
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
  });
}
