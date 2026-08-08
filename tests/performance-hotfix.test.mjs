import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildLowMemoryHistoryArchiveVolume, createLowMemoryHistoryArchivePlan } from "../apps/extension/dist/history-archive.js";
import { readZipEntries } from "../apps/extension/dist/zip-reader.js";
import { createHistoryJob, reconcileDurableProgress, runUnifiedHistoryBackup } from "../apps/extension/src/history-engine.js";
import { createStoredZipBlob } from "../apps/extension/src/zip.js";

function rawConversation(id, text = "hello") {
  return {
    id,
    title: `Conversation ${id}`,
    create_time: 1,
    update_time: 2,
    current_node: `${id}-assistant`,
    mapping: {
      [`${id}-user`]: { id: `${id}-user`, parent: null, children: [`${id}-assistant`], message: { id: `${id}-m1`, author: { role: "user" }, create_time: 1, content: { content_type: "text", parts: [text] }, metadata: {} } },
      [`${id}-assistant`]: { id: `${id}-assistant`, parent: `${id}-user`, children: [], message: { id: `${id}-m2`, author: { role: "assistant" }, create_time: 2, content: { content_type: "text", parts: [`answer ${text}`] }, metadata: {} } },
    },
  };
}

function metadata(id) {
  return { id, title: `Conversation ${id}`, createTime: 1, updateTime: 2, locations: [{ type: "regular", present: true, projectId: null, projectTitle: null, workspaceId: null }] };
}

test("Blob ZIP builder produces a valid archive without concatenating the full output", async () => {
  const blob = createStoredZipBlob([
    { name: "a.txt", data: "alpha" },
    { name: "nested/b.bin", data: Uint8Array.of(1, 2, 3, 4) },
  ], new Date("2026-07-26T00:00:00Z"));
  const entries = await readZipEntries(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(new TextDecoder().decode(entries.get("a.txt")), "alpha");
  assert.deepEqual([...entries.get("nested/b.bin")], [1, 2, 3, 4]);
});

test("low-memory archive planning never calls bulk artifact or asset loaders", async () => {
  const ids = Array.from({ length: 120 }, (_, index) => `conv-${String(index).padStart(4, "0")}`);
  const artifacts = new Map(ids.map((id) => [id, { conversationId: id, title: id, metadata: metadata(id), raw: rawConversation(id, "x".repeat(2048)) }]));
  const artifactReads = [];
  const store = {
    async listArtifactIds() { return ids; },
    async getArtifact(_jobId, id) { artifactReads.push(id); return structuredClone(artifacts.get(id)); },
    async listAssetMetadata() { return []; },
    async getAsset() { return null; },
    async listArtifacts() { throw new Error("bulk artifact load is forbidden"); },
    async listAssets() { throw new Error("bulk asset load is forbidden"); },
  };
  const job = {
    id: "large-job",
    scope: "all-conversations",
    accountContext: { workspaceId: null, workspaceLabel: "个人空间" },
    conversations: ids.map(metadata),
    projects: [],
    failures: [],
    warnings: [],
    completedAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
    stats: { regular: ids.length, archived: 0, projects: 0, projectConversations: 0, completed: ids.length, failed: 0 },
    assets: { inventory: [], completedKeys: [], failures: [], unsupportedKeys: [] },
  };
  const plan = await createLowMemoryHistoryArchivePlan({ store, job, maxVolumeBytes: 8 * 1024 * 1024, generatedAt: new Date("2026-07-26T00:00:00Z") });
  assert.ok(plan.volumeCount >= 3, `expected multiple volumes, got ${plan.volumeCount}`);
  assert.equal(artifactReads.length, ids.length);
  assert.equal("conversations" in plan.manifest, false);
  assert.equal("assets" in plan.manifest, false);
  artifactReads.length = 0;
  const first = await buildLowMemoryHistoryArchiveVolume({ plan, volumeNumber: 1, store, job });
  const firstDescriptors = plan.volumes[0].descriptors.filter((item) => item.type === "conversation").length;
  assert.equal(artifactReads.length, firstDescriptors);
  assert.ok(artifactReads.length < ids.length);
  const entries = await readZipEntries(new Uint8Array(await first.blob.arrayBuffer()), { maxEntries: 10000, maxTotalUncompressedBytes: 64 * 1024 * 1024 });
  assert.ok(entries.has("index.html"));
  assert.ok(entries.has("index-data.js"));
  assert.ok(entries.has("conversation-index.json"));
  assert.ok(entries.has("volume-map.json"));
  const indexHtml = new TextDecoder().decode(entries.get("index.html"));
  assert.match(indexHtml, /加载更多/);
  assert.doesNotMatch(indexHtml, /Conversation conv-0119/);
});

test("large history indexing checkpoints in batches instead of saving every page and item", async () => {
  const count = 360;
  const list = Array.from({ length: count }, (_, index) => ({ id: `bulk-${index}`, title: `Bulk ${index}`, update_time: 2 }));
  let job = null;
  let saveCount = 0;
  const artifacts = new Map();
  const store = {
    async getLatestJob() { return job ? structuredClone(job) : null; },
    async saveJob(value) { saveCount += 1; job = structuredClone(value); },
    async putArtifact(_jobId, id, artifact) { artifacts.set(id, structuredClone(artifact)); },
    async getArtifact(_jobId, id) { return artifacts.has(id) ? structuredClone(artifacts.get(id)) : null; },
    async listArtifactIds() { return [...artifacts.keys()]; },
    async putAsset() {},
    async getAsset() { return null; },
    async listAssetKeys() { return []; },
    async listAssetMetadata() { return []; },
  };
  const transport = {
    async getContext() { return { workspaceId: null, workspaceLabel: "个人空间", authenticated: true }; },
    async listConversations({ offset, limit, archived }) { return archived ? { items: [], total: 0 } : { items: list.slice(offset, offset + limit), total: count }; },
    async listProjects() { return { items: [], cursor: null }; },
    async listProjectConversations() { return { items: [], cursor: null }; },
    async fetchConversation(id) { return rawConversation(id); },
    async downloadAsset() { throw new Error("no assets expected"); },
  };
  const result = await runUnifiedHistoryBackup({ store, transport, requestDelayMs: 0 });
  assert.equal(result.stats.completed, count);
  assert.equal(artifacts.size, count);
  assert.ok(saveCount < 40, `expected batched checkpoints, observed ${saveCount}`);
});

test("collection completion no longer auto-starts archive generation", async () => {
  const source = await readFile(new URL("../apps/extension/src/backup.js", import.meta.url), "utf8");
  const runBackupStart = source.indexOf("async function runBackup");
  const listenersStart = source.indexOf("elements.start.addEventListener", runBackupStart);
  const runBackupBody = source.slice(runBackupStart, listenersStart);
  assert.doesNotMatch(runBackupBody, /await\s+downloadArchive\s*\(/);
  assert.match(runBackupBody, /生成低内存备份分卷/);
});

test("phase-aware progress advances during indexing and long-running collection", async () => {
  const { computeBackupProgress } = await import("../apps/extension/src/backup-progress.js");
  const indexing = {
    status: "indexing",
    sources: {
      regular: { pagination: { scanIds: Array.from({ length: 50 }, (_, i) => String(i)), reportedTotal: 100, indexingComplete: false } },
      archived: { pagination: { scanIds: [], reportedTotal: 0, indexingComplete: false } },
      projects: { pagination: { pages: 0, indexingComplete: false } },
    },
    projects: [],
    stats: {},
  };
  assert.ok(computeBackupProgress(indexing) > 1);
  const exporting = { ...indexing, status: "exporting", stats: { indexed: 100, completed: 40, failed: 0 } };
  assert.ok(computeBackupProgress(exporting) >= 37);
  const completed = { ...exporting, status: "completed" };
  assert.equal(computeBackupProgress(completed), 100);
});


test("durable reconciliation recovers artifacts and assets saved after the last job checkpoint", async () => {
  const job = createHistoryJob("reconcile-job");
  job.conversations = [metadata("saved"), metadata("missing")];
  job.assets.inventory = [
    { key: "file:saved", downloadable: true },
    { key: "file:missing", downloadable: true },
  ];
  job.completedIds = [];
  job.assets.completedKeys = [];
  const store = {
    async listArtifactIds() { return ["saved"]; },
    async listAssetKeys() { return ["file:saved"]; },
    async getAsset(_jobId, key) { return key === "file:saved" ? { sizeBytes: 42 } : null; },
  };
  await reconcileDurableProgress(job, store);
  assert.deepEqual(job.completedIds, ["saved"]);
  assert.deepEqual(job.assets.completedKeys, ["file:saved"]);
  assert.equal(job.assets.downloadedBytes, 42);
});
