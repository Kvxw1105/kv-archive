import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  CONTEXT_VAULT_DB_NAME,
  CONTEXT_VAULT_DB_VERSION,
  CONTEXT_VAULT_STORES,
  ensureContextVaultStores,
} from "../apps/extension/dist/db-schema.js";

test("all extension surfaces share one monotonic IndexedDB schema", async () => {
  assert.equal(CONTEXT_VAULT_DB_NAME, "context-vault");
  assert.equal(CONTEXT_VAULT_DB_VERSION, 13);

  const historySource = await readFile("apps/extension/dist/history-store.js", "utf8");
  const librarySource = await readFile("apps/extension/dist/library-store.js", "utf8");
  assert.match(historySource, /openContextVaultDatabase/);
  assert.match(librarySource, /openContextVaultDatabase/);
  assert.doesNotMatch(historySource, /DB_VERSION\s*=\s*3/);
  assert.doesNotMatch(librarySource, /DB_VERSION\s*=\s*4/);
});

test("shared database upgrade creates backup, library and state stores together", () => {
  const created = new Map();
  const db = {
    objectStoreNames: { contains(name) { return created.has(name); } },
    createObjectStore(name, options) {
      const indexes = [];
      created.set(name, { options, indexes });
      return { createIndex(indexName, keyPath, indexOptions) { indexes.push({ indexName, keyPath, indexOptions }); } };
    },
  };

  ensureContextVaultStores(db);
  assert.deepEqual([...created.keys()].sort(), Object.values(CONTEXT_VAULT_STORES).sort());
  assert.ok(created.get(CONTEXT_VAULT_STORES.historyAssets).indexes.some((index) => index.indexName === "assetKey"));
  assert.ok(created.get(CONTEXT_VAULT_STORES.stateProposals).indexes.some((index) => index.indexName === "status"));
  assert.equal(created.get(CONTEXT_VAULT_STORES.contentObjects).options.keyPath,"key");
  assert.ok(created.get(CONTEXT_VAULT_STORES.contentObjects).indexes.some((index) => index.indexName === "kind"));
  assert.notEqual(CONTEXT_VAULT_STORES.contentObjects,CONTEXT_VAULT_STORES.captureItems,"editable content must not reuse the raw evidence object store");
  assert.ok(created.get(CONTEXT_VAULT_STORES.captureItems).indexes.some((index) => index.indexName === "projectId"));
  assert.ok(created.get(CONTEXT_VAULT_STORES.captureVersions).indexes.some((index) => index.indexName === "objectId"));
  assert.ok(created.get(CONTEXT_VAULT_STORES.captureRelations).indexes.some((index) => index.indexName === "relation"));
  assert.ok(created.get(CONTEXT_VAULT_STORES.captureOperations).indexes.some((index) => index.indexName === "createdAt"));
  assert.ok(created.get(CONTEXT_VAULT_STORES.capturePromotions).indexes.some((index) => index.indexName === "status"));
  assert.ok(created.get(CONTEXT_VAULT_STORES.captureRecoveryRuns).indexes.some((index) => index.indexName === "sourceReceiptId"));
  assert.ok(created.get(CONTEXT_VAULT_STORES.snapshots).indexes.some((index) => index.indexName === "fingerprint"));
  assert.ok(created.has(CONTEXT_VAULT_STORES.scheduler));
  assert.ok(created.has(CONTEXT_VAULT_STORES.schedulerRuns));
  assert.ok(created.has(CONTEXT_VAULT_STORES.memoryProfiles));
  assert.ok(created.has(CONTEXT_VAULT_STORES.memoryVersions));
  assert.ok(created.has(CONTEXT_VAULT_STORES.memoryEvents));
  assert.ok(created.has(CONTEXT_VAULT_STORES.memoryGateConfigs));
  assert.ok(created.get(CONTEXT_VAULT_STORES.memoryGateRuns).indexes.some((index) => index.indexName === "projectId"));
  assert.ok(created.has(CONTEXT_VAULT_STORES.knowledgeExportProfiles));
  assert.ok(created.get(CONTEXT_VAULT_STORES.knowledgeExportPaths).indexes.some((index) => index.indexName === "projectId"));
  assert.ok(created.get(CONTEXT_VAULT_STORES.knowledgeExportRuns).indexes.some((index) => index.indexName === "status"));
  assert.ok(created.has(CONTEXT_VAULT_STORES.conversationSelections));
  assert.ok(created.get(CONTEXT_VAULT_STORES.conversationSelections).indexes.some((index) => index.indexName === "provider"));
  assert.ok(created.has(CONTEXT_VAULT_STORES.conversationCatalogs));
  assert.ok(created.get(CONTEXT_VAULT_STORES.conversationCatalogs).indexes.some((index) => index.indexName === "cachedAt"));
});
