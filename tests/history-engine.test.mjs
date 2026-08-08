import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_HISTORY_JOB_ID,
  createHistoryJob,
  migrateHistoryJob,
  runUnifiedHistoryBackup,
  withRetry,
} from "../apps/extension/src/history-engine.js";

function rawConversation(id, title, updateTime = 2) {
  return {
    id,
    title,
    create_time: 1,
    update_time: updateTime,
    current_node: `${id}-assistant`,
    mapping: {
      [`${id}-user`]: {
        id: `${id}-user`, parent: null, children: [`${id}-assistant`],
        message: { id: `${id}-m1`, author: { role: "user" }, create_time: 1, content: { content_type: "text", parts: ["hello"] }, metadata: {} },
      },
      [`${id}-assistant`]: {
        id: `${id}-assistant`, parent: `${id}-user`, children: [],
        message: { id: `${id}-m2`, author: { role: "assistant" }, create_time: updateTime, content: { content_type: "text", parts: ["world"] }, metadata: {} },
      },
    },
  };
}

function memoryStore(seedJob = null, seedArtifacts = [], seedAssets = []) {
  let job = seedJob ? structuredClone(seedJob) : null;
  const artifacts = new Map(seedArtifacts.map((artifact) => [artifact.conversationId, structuredClone(artifact)]));
  const assets = new Map(seedAssets.map((asset) => [asset.assetKey, structuredClone(asset)]));
  return {
    async getLatestJob() { return job ? structuredClone(job) : null; },
    async saveJob(value) { job = structuredClone(value); },
    async putArtifact(_jobId, conversationId, artifact) { artifacts.set(conversationId, structuredClone(artifact)); },
    async deleteArtifact(_jobId, conversationId) { artifacts.delete(conversationId); },
    async listArtifacts() { return [...artifacts.values()].map((value) => structuredClone(value)); },
    async putAsset(_jobId, assetKey, asset) { assets.set(assetKey, structuredClone(asset)); },
    async getAsset(_jobId, assetKey) { return assets.has(assetKey) ? structuredClone(assets.get(assetKey)) : null; },
    async listAssets() { return [...assets.values()].map((value) => structuredClone(value)); },
    async deleteAsset(_jobId, assetKey) { assets.delete(assetKey); },
    async clearJob() { job = null; artifacts.clear(); assets.clear(); },
  };
}

function unifiedTransport(overrides = {}) {
  return {
    async getContext() { return { workspaceId: null, workspaceLabel: "个人空间", authenticated: true }; },
    async listConversations({ archived }) {
      return archived
        ? { items: [{ id: "archived-1", title: "Archived", is_archived: true }], total: 1 }
        : { items: [{ id: "regular-1", title: "Regular" }], total: 1 };
    },
    async listProjects() {
      return { items: [{ id: "g-p-1", title: "Alpha", files: [], workspaceId: null }], cursor: null };
    },
    async listProjectConversations({ cursor }) {
      return cursor === "0"
        ? { items: [{ id: "project-1", title: "Project One", locations: [{ type: "project", projectId: "g-p-1", projectTitle: "Alpha", workspaceId: null }] }], cursor: null }
        : { items: [], cursor: null };
    },
    async fetchConversation(id) { return rawConversation(id, id); },
    async downloadAsset(asset) { return { bytes: Uint8Array.of(1), fileName: asset.fileName, mimeType: asset.mimeType || "application/octet-stream", expectedBytes: asset.expectedBytes ?? 1 }; },
    ...overrides,
  };
}

test("indexes regular, archived and project conversations into one recoverable job", async () => {
  const store = memoryStore();
  const fetched = [];
  const result = await runUnifiedHistoryBackup({
    store,
    requestDelayMs: 0,
    transport: unifiedTransport({
      async fetchConversation(id) { fetched.push(id); return rawConversation(id, id); },
    }),
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(fetched.sort(), ["archived-1", "project-1", "regular-1"]);
  assert.equal(result.stats.regular, 1);
  assert.equal(result.stats.archived, 1);
  assert.equal(result.stats.projects, 1);
  assert.equal(result.stats.projectConversations, 1);
  assert.equal((await store.listArtifacts()).length, 3);
  assert.equal(result.sources.regular.pagination.indexingComplete, true);
  assert.equal(result.sources.archived.pagination.indexingComplete, true);
  assert.equal(result.projects[0].pagination.indexingComplete, true);
});

test("migrates a completed Batch 1 job in place and does not refetch verified regular artifacts", async () => {
  const legacy = {
    version: 1,
    id: DEFAULT_HISTORY_JOB_ID,
    status: "completed",
    startedAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:01:00.000Z",
    completedAt: "2026-07-26T00:01:00.000Z",
    pagination: { offset: 28, limit: 28, consecutiveEmptyPages: 0, indexingComplete: true, reportedTotal: 1 },
    conversations: [{ id: "regular-1", title: "Regular", createTime: 1, updateTime: 2, isArchived: false, raw: { id: "regular-1" } }],
    completedIds: ["regular-1"],
    failures: [],
    stats: { retries: 0 },
  };
  const store = memoryStore(legacy, [{ conversationId: "regular-1", title: "Regular", raw: rawConversation("regular-1", "Regular") }]);
  const fetched = [];
  const result = await runUnifiedHistoryBackup({
    store,
    requestDelayMs: 0,
    transport: unifiedTransport({
      async listConversations({ archived }) { return archived ? { items: [{ id: "archived-1", title: "Archived" }], total: 1 } : (() => { throw new Error("regular must not reindex after migration"); })(); },
      async fetchConversation(id) { fetched.push(id); return rawConversation(id, id); },
    }),
  });
  assert.equal(result.version, 3);
  assert.equal(result.status, "completed");
  assert.deepEqual(fetched.sort(), ["archived-1", "project-1"]);
  assert.equal(result.completedIds.includes("regular-1"), true);
  assert.equal((await store.listArtifacts()).length, 3);
});

test("rejects mixing a different workspace into an existing job", async () => {
  const job = createHistoryJob();
  job.accountContext = { workspaceId: "11111111-1111-1111-1111-111111111111", workspaceLabel: "Workspace A" };
  job.conversations = [{ id: "a", title: "A", locations: [{ type: "regular", projectId: null, projectTitle: null, workspaceId: job.accountContext.workspaceId }] }];
  const store = memoryStore(job);
  await assert.rejects(
    runUnifiedHistoryBackup({
      store,
      requestDelayMs: 0,
      transport: unifiedTransport({
        async getContext() { return { workspaceId: "22222222-2222-2222-2222-222222222222", workspaceLabel: "Workspace B" }; },
      }),
    }),
    /不一致/,
  );
});

test("resumes a paused unified job without repeating completed conversations", async () => {
  const job = createHistoryJob();
  job.status = "paused";
  job.accountContext = { workspaceId: null, workspaceLabel: "个人空间" };
  job.sources.regular.pagination.indexingComplete = true;
  job.sources.archived.pagination.indexingComplete = true;
  job.sources.projects.pagination.indexingComplete = true;
  job.projects = [{ id: "g-p-1", title: "Alpha", conversationIds: ["project-1"], files: [], pagination: { started: true, nextCursor: null, indexingComplete: true, pages: 1 } }];
  job.conversations = [
    { id: "regular-1", title: "Regular", updateTime: 2, locations: [{ type: "regular", projectId: null, projectTitle: null, workspaceId: null }] },
    { id: "project-1", title: "Project", updateTime: 2, locations: [{ type: "project", projectId: "g-p-1", projectTitle: "Alpha", workspaceId: null }] },
  ];
  job.completedIds = ["regular-1"];
  job.completedVersions = { "regular-1": "2" };
  const store = memoryStore(job, [{ conversationId: "regular-1", title: "Regular", raw: rawConversation("regular-1", "Regular") }]);
  const fetched = [];
  const result = await runUnifiedHistoryBackup({
    store,
    requestDelayMs: 0,
    transport: unifiedTransport({
      async listConversations() { throw new Error("must not reindex"); },
      async listProjects() { throw new Error("must not reindex"); },
      async listProjectConversations() { throw new Error("must not reindex"); },
      async fetchConversation(id) { fetched.push(id); return rawConversation(id, id); },
    }),
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(fetched, ["project-1"]);
});

test("a completed job performs an incremental index and refetches only updated or new conversations", async () => {
  const job = createHistoryJob();
  job.status = "completed";
  job.completedAt = "2026-07-26T00:00:00.000Z";
  job.accountContext = { workspaceId: null, workspaceLabel: "个人空间" };
  job.conversations = [{ id: "regular-1", title: "Regular", updateTime: 2, locations: [{ type: "regular", projectId: null, projectTitle: null, workspaceId: null }] }];
  job.completedIds = ["regular-1"];
  job.completedVersions = { "regular-1": "2" };
  const store = memoryStore(job, [{ conversationId: "regular-1", title: "Regular", raw: rawConversation("regular-1", "Regular", 2) }]);
  const fetched = [];
  const result = await runUnifiedHistoryBackup({
    store,
    requestDelayMs: 0,
    transport: unifiedTransport({
      async listConversations({ archived }) {
        return archived ? { items: [], total: 0 } : { items: [{ id: "regular-1", title: "Regular updated", updateTime: 3, locations: [{ type: "regular", projectId: null, projectTitle: null, workspaceId: null }] }], total: 1 };
      },
      async listProjects() { return { items: [], cursor: null }; },
      async fetchConversation(id) { fetched.push(id); return rawConversation(id, id, 3); },
    }),
  });
  assert.deepEqual(fetched, ["regular-1"]);
  assert.equal(result.completedVersions["regular-1"], "3");
});

test("incremental refresh closes source counts when a conversation moves to archive", async () => {
  const job = createHistoryJob();
  job.status = "completed";
  job.completedAt = "2026-07-26T00:00:00.000Z";
  job.accountContext = { workspaceId: null, workspaceLabel: "个人空间" };
  job.conversations = [{ id: "moved", title: "Moved", updateTime: 2, locations: [{ type: "regular", projectId: null, projectTitle: null, workspaceId: null, present: true }] }];
  job.completedIds = ["moved"];
  job.completedVersions = { moved: "2" };
  const store = memoryStore(job, [{ conversationId: "moved", title: "Moved", raw: rawConversation("moved", "Moved", 2) }]);
  const result = await runUnifiedHistoryBackup({
    store,
    requestDelayMs: 0,
    transport: unifiedTransport({
      async listConversations({ archived }) {
        return archived
          ? { items: [{ id: "moved", title: "Moved", updateTime: 2, locations: [{ type: "archived", projectId: null, projectTitle: null, workspaceId: null, present: true }] }], total: 1 }
          : { items: [], total: 0 };
      },
      async listProjects() { return { items: [], cursor: null }; },
      async fetchConversation() { throw new Error("unchanged conversation should not refetch"); },
    }),
  });
  const metadata = result.conversations.find((item) => item.id === "moved");
  assert.equal(result.stats.regular, 0);
  assert.equal(result.stats.archived, 1);
  assert.equal(metadata.locations.find((location) => location.type === "regular").present, false);
  assert.equal(metadata.locations.find((location) => location.type === "archived").present, true);
});

test("records a failed conversation and retries only that item later", async () => {
  const store = memoryStore();
  const first = await runUnifiedHistoryBackup({
    store,
    requestDelayMs: 0,
    transport: unifiedTransport({
      async listConversations({ archived }) { return archived ? { items: [], total: 0 } : { items: [{ id: "bad", title: "Bad" }], total: 1 }; },
      async listProjects() { return { items: [], cursor: null }; },
      async fetchConversation() { const error = new Error("bad request"); error.status = 400; throw error; },
    }),
  });
  assert.equal(first.status, "completed_with_errors");
  const calls = [];
  const second = await runUnifiedHistoryBackup({
    store,
    requestDelayMs: 0,
    transport: unifiedTransport({
      async listConversations() { throw new Error("should not reindex failed-only retry"); },
      async listProjects() { throw new Error("should not reindex failed-only retry"); },
      async fetchConversation(id) { calls.push(id); return rawConversation(id, id); },
    }),
  });
  assert.deepEqual(calls, ["bad"]);
  assert.equal(second.status, "completed");
  assert.equal(second.failures.length, 0);
});

test("retries transient failures with bounded backoff", async () => {
  let attempts = 0;
  const retries = [];
  const value = await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) { const error = new Error("rate limited"); error.status = 429; error.retryAfterMs = 1; throw error; }
    return "ok";
  }, { maxAttempts: 4, baseDelayMs: 1, onRetry: (event) => retries.push(event.attempt) });
  assert.equal(value, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(retries, [1, 2]);
});

test("migrateHistoryJob preserves Batch 1 verification state", () => {
  const migrated = migrateHistoryJob({
    version: 1,
    id: DEFAULT_HISTORY_JOB_ID,
    status: "paused",
    pagination: { offset: 56, limit: 28, indexingComplete: true },
    conversations: [{ id: "a", title: "A", updateTime: 5 }],
    completedIds: ["a"],
    failures: [],
    stats: { retries: 2 },
  });
  assert.equal(migrated.version, 3);
  assert.equal(migrated.sources.regular.pagination.offset, 56);
  assert.equal(migrated.completedVersions.a, "5");
  assert.equal(migrated.stats.retries, 2);
});

test("discovers and downloads a shared asset only once across conversations and Projects", async () => {
  const sharedPart = { content_type: "image_asset_pointer", asset_pointer: "sediment://file_shared123456", file_name: "shared.png", mime_type: "image/png", size_bytes: 3 };
  const store = memoryStore();
  const calls = [];
  const result = await runUnifiedHistoryBackup({
    store,
    requestDelayMs: 0,
    assetPolicy: "download",
    transport: unifiedTransport({
      async listConversations({ archived }) { return archived ? { items: [], total: 0 } : { items: [{ id: "c1", title: "One" }, { id: "c2", title: "Two" }], total: 2 }; },
      async listProjects() { return { items: [{ id: "g-p-1", title: "Alpha", files: [{ file_id: "file_shared123456", name: "shared.png", type: "image/png", size: 3 }], workspaceId: null }], cursor: null }; },
      async listProjectConversations() { return { items: [], cursor: null }; },
      async fetchConversation(id) {
        const raw = rawConversation(id, id);
        raw.mapping[`${id}-user`].message.content = { content_type: "multimodal_text", parts: ["image", sharedPart] };
        return raw;
      },
      async downloadAsset(asset) { calls.push(asset.key); return { bytes: Uint8Array.of(1, 2, 3), fileName: "shared.png", mimeType: "image/png", expectedBytes: 3 }; },
    }),
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["file:file_shared123456"]);
  assert.equal(result.assets.inventory.length, 1);
  assert.equal(result.assets.completedKeys.length, 1);
  assert.equal((await store.listAssets()).length, 1);
});

test("retries only failed assets without reindexing completed conversations", async () => {
  const raw = rawConversation("c1", "One");
  raw.mapping["c1-user"].message.content = { content_type: "multimodal_text", parts: [{ asset_pointer: "sediment://file_retry123456", file_name: "retry.pdf", size_bytes: 2 }] };
  const store = memoryStore();
  const first = await runUnifiedHistoryBackup({
    store, requestDelayMs: 0, assetPolicy: "download",
    transport: unifiedTransport({
      async listConversations({ archived }) { return archived ? { items: [], total: 0 } : { items: [{ id: "c1", title: "One" }], total: 1 }; },
      async listProjects() { return { items: [], cursor: null }; },
      async fetchConversation() { return raw; },
      async downloadAsset() { const error = new Error("asset failed"); error.status = 400; throw error; },
    }),
  });
  assert.equal(first.status, "completed_with_errors");
  assert.equal(first.assets.failures.length, 1);
  let fetchCalls = 0;
  let listCalls = 0;
  const second = await runUnifiedHistoryBackup({
    store, requestDelayMs: 0, assetPolicy: "download",
    transport: unifiedTransport({
      async listConversations() { listCalls += 1; throw new Error("must not reindex"); },
      async listProjects() { listCalls += 1; throw new Error("must not reindex"); },
      async fetchConversation() { fetchCalls += 1; throw new Error("must not refetch conversation"); },
      async downloadAsset() { return { bytes: Uint8Array.of(1, 2), fileName: "retry.pdf", mimeType: "application/pdf", expectedBytes: 2 }; },
    }),
  });
  assert.equal(listCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(second.status, "completed");
  assert.equal(second.assets.failures.length, 0);
  assert.equal((await store.listAssets()).length, 1);
});

test("migrates a Batch 2 job to the asset-aware task schema", () => {
  const batch2 = createHistoryJob();
  batch2.version = 2;
  delete batch2.assets;
  const migrated = migrateHistoryJob(batch2);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.assets.status, "pending");
  assert.match(migrated.warnings.join("\n"), /v0\.4\.0/);
});


test("reference-only scheduled mode inventories assets without downloading binaries", async () => {
  const store = memoryStore();
  let downloads = 0;
  const raw = rawConversation("regular-1", "Regular");
  raw.mapping["regular-1-user"].message.content.parts.push({ asset_pointer: "file-service://file-ref-only", name: "large.pdf", mime_type: "application/pdf", size_bytes: 99 });
  const result = await runUnifiedHistoryBackup({
    store,
    requestDelayMs: 0,
    assetPolicy: "references-only",
    transport: unifiedTransport({
      async listConversations({ archived }) { return archived ? { items: [], total: 0 } : { items: [{ id: "regular-1", title: "Regular" }], total: 1 }; },
      async listProjects() { return { items: [], cursor: null }; },
      async fetchConversation() { return raw; },
      async downloadAsset() { downloads += 1; throw new Error("must not download"); },
    }),
  });
  assert.equal(result.status, "completed");
  assert.equal(result.assets.status, "inventory_only");
  assert.equal(result.assets.inventory.length, 1);
  assert.equal(downloads, 0);
});

test("manual backup defaults to conversation-first reference-only mode", async () => {
  const store = memoryStore();
  let downloads = 0;
  const raw = rawConversation("regular-1", "Regular");
  raw.mapping["regular-1-user"].message.content.parts.push({ asset_pointer: "file-service://file-default-ref", name: "unused.bin", size_bytes: 12 });
  const result = await runUnifiedHistoryBackup({
    store,
    requestDelayMs: 0,
    transport: unifiedTransport({
      async listConversations({ archived }) { return archived ? { items: [], total: 0 } : { items: [{ id: "regular-1", title: "Regular" }], total: 1 }; },
      async listProjects() { return { items: [], cursor: null }; },
      async fetchConversation() { return raw; },
      async downloadAsset() { downloads += 1; throw new Error("default mode must not download attachments"); },
    }),
  });
  assert.equal(result.assetPolicy, "references-only");
  assert.equal(result.assets.status, "inventory_only");
  assert.equal(downloads, 0);
});

test("an inaccessible attachment does not masquerade as a logged-out session", async () => {
  const store = memoryStore();
  const raw = rawConversation("regular-1", "Regular");
  raw.mapping["regular-1-user"].message.content.parts.push({ asset_pointer: "file-service://file-forbidden", name: "forbidden.pdf", size_bytes: 2 });
  let sessionChecks = 0;
  const result = await runUnifiedHistoryBackup({
    store,
    requestDelayMs: 0,
    assetPolicy: "download",
    transport: unifiedTransport({
      async listConversations({ archived }) { return archived ? { items: [], total: 0 } : { items: [{ id: "regular-1", title: "Regular" }], total: 1 }; },
      async listProjects() { return { items: [], cursor: null }; },
      async fetchConversation() { return raw; },
      async downloadAsset() { const error = new Error("signed asset unavailable"); error.status = 403; throw error; },
      async verifySession() { sessionChecks += 1; return true; },
    }),
  });
  assert.equal(sessionChecks, 1);
  assert.equal(result.status, "completed_with_errors");
  assert.equal(result.assets.failures.length, 1);
  assert.match(result.warnings.join("\n"), /对话备份不受影响/);
});

test("a confirmed expired ChatGPT session still pauses the job", async () => {
  const store = memoryStore();
  const raw = rawConversation("regular-1", "Regular");
  raw.mapping["regular-1-user"].message.content.parts.push({ asset_pointer: "file-service://file-auth-expired", name: "private.pdf", size_bytes: 2 });
  await assert.rejects(() => runUnifiedHistoryBackup({
    store,
    requestDelayMs: 0,
    assetPolicy: "download",
    transport: unifiedTransport({
      async listConversations({ archived }) { return archived ? { items: [], total: 0 } : { items: [{ id: "regular-1", title: "Regular" }], total: 1 }; },
      async listProjects() { return { items: [], cursor: null }; },
      async fetchConversation() { return raw; },
      async downloadAsset() { const error = new Error("auth expired"); error.status = 401; throw error; },
      async verifySession() { return false; },
    }),
  }), /登录状态已失效/);
  const saved = await store.getLatestJob();
  assert.equal(saved.status, "paused");
  assert.equal(saved.assets.status, "paused");
});

test("asset byte ceiling is forwarded to the transport", async () => {
  const store = memoryStore();
  const raw = rawConversation("regular-1", "Regular");
  raw.mapping["regular-1-user"].message.content.parts.push({ asset_pointer: "file-service://file-sized", name: "sized.pdf", mime_type: "application/pdf", size_bytes: 2 });
  let receivedMaxBytes = null;
  const result = await runUnifiedHistoryBackup({
    store,
    requestDelayMs: 0,
    assetPolicy: "download",
    maxAssetBytes: 7 * 1024 * 1024,
    transport: unifiedTransport({
      async listConversations({ archived }) { return archived ? { items: [], total: 0 } : { items: [{ id: "regular-1", title: "Regular" }], total: 1 }; },
      async listProjects() { return { items: [], cursor: null }; },
      async fetchConversation() { return raw; },
      async downloadAsset(asset, options) { receivedMaxBytes = options.maxBytes; return { bytes: Uint8Array.of(1, 2), fileName: asset.fileName, mimeType: asset.mimeType, expectedBytes: 2 }; },
    }),
  });
  assert.equal(result.status, "completed");
  assert.equal(receivedMaxBytes, 7 * 1024 * 1024);
});

test("scheduled refresh can reindex a warning-completed job while ordinary retry remains failure-only", async () => {
  const job = createHistoryJob();
  job.status = "completed_with_errors";
  job.accountContext = { workspaceId: null, workspaceLabel: "个人空间" };
  job.sources.regular.pagination.indexingComplete = true;
  job.sources.archived.pagination.indexingComplete = true;
  job.sources.projects.pagination.indexingComplete = true;
  job.conversations = [{ id: "old", title: "Old", updateTime: 2, locations: [{ type: "regular", present: true }] }];
  job.completedIds = ["old"];
  job.completedVersions = { old: "2" };
  const store = memoryStore(job, [{ conversationId: "old", title: "Old", raw: rawConversation("old", "Old") }]);
  let listCalls = 0;
  const result = await runUnifiedHistoryBackup({
    store,
    requestDelayMs: 0,
    refreshCompletedWithErrors: true,
    assetPolicy: "references-only",
    transport: unifiedTransport({
      async listConversations({ archived }) { listCalls += 1; return archived ? { items: [], total: 0 } : { items: [{ id: "old", title: "Old", updateTime: 2 }], total: 1 }; },
      async listProjects() { return { items: [], cursor: null }; },
      async fetchConversation() { throw new Error("unchanged conversation must not refetch"); },
    }),
  });
  assert.ok(listCalls >= 2);
  assert.equal(result.status, "completed");
});

test("incremental scan removes absent current references while older snapshot objects can remain", async () => {
  const job = createHistoryJob();
  job.status = "completed";
  job.accountContext = { workspaceId: null, workspaceLabel: "个人空间" };
  job.conversations = [{ id: "deleted", title: "Deleted", updateTime: 2, locations: [{ type: "regular", present: true }] }];
  job.completedIds = ["deleted"];
  job.completedVersions = { deleted: "2" };
  const store = memoryStore(job, [{ conversationId: "deleted", title: "Deleted", raw: rawConversation("deleted", "Deleted") }]);
  const result = await runUnifiedHistoryBackup({
    store,
    requestDelayMs: 0,
    assetPolicy: "references-only",
    transport: unifiedTransport({
      async listConversations() { return { items: [], total: 0 }; },
      async listProjects() { return { items: [], cursor: null }; },
      async fetchConversation() { throw new Error("absent conversation must not fetch"); },
    }),
  });
  assert.equal(result.status, "completed");
  assert.equal((await store.listArtifacts()).length, 0);
  assert.deepEqual(result.completedIds, []);
  assert.equal(result.conversations[0].locations.every((location) => location.present === false), true);
});
