import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeChatGPTConversation } from "../dist/packages/normalizer/src/index.js";
import { buildVaultIndexBundle } from "../apps/extension/dist/vault-index.js";
import { createMemoryLibraryStore } from "../apps/extension/dist/library-store.js";
import { createMemoryCaptureStore } from "../apps/extension/dist/capture-store.js";
import { buildKnowledgeExportVolume, createKnowledgeExportPlan, resumableKnowledgeRun } from "../apps/extension/dist/knowledge-export.js";
import { readZipEntries } from "../apps/extension/dist/zip-reader.js";

const rawBase = JSON.parse(await readFile("fixtures/synthetic/knowledge-graph/conversation-1.json", "utf8"));

async function createProjectStore(count = 4) {
  const store = createMemoryLibraryStore();
  for (let index = 0; index < count; index += 1) {
    const raw = structuredClone(rawBase);
    raw.id = `obsidian-conversation-${index + 1}`;
    raw.title = `Obsidian Conversation ${index + 1}`;
    raw.project_id = "project-obsidian";
    raw.mapping["assistant-1"].message.content.parts[0] += ` fixture ${index + 1} `.repeat(30000);
    const canonical = normalizeChatGPTConversation(raw, { adapter: "obsidian-test" });
    const bundle = await buildVaultIndexBundle({
      canonical,
      rawEvidence: raw,
      source: { kind: "context-vault", fileName: `fixture-${index + 1}.zip`, fingerprint: `fixture-${index + 1}` },
      sourceMetadata: { locations: [{ type: "project", present: true, projectId: "project-obsidian", projectTitle: "Obsidian Project" }] },
      importedAt: "2026-07-26T00:00:00.000Z",
    });
    await store.upsertBundle(bundle);
  }
  return store;
}

function createHistoryAssetStore() {
  const bytes = new TextEncoder().encode("synthetic attachment payload");
  const job = {
    id: "regular-history-v1",
    assets: {
      inventory: [{
        key: "file:file_fixture_asset",
        fileId: "file_fixture_asset",
        fileName: "project-diagram.png",
        mimeType: "image/png",
        expectedBytes: bytes.byteLength,
        conversationIds: ["obsidian-conversation-1"],
        projectIds: ["project-obsidian"],
        references: [{ conversationId: "obsidian-conversation-1", projectId: "project-obsidian", nodeId: "user-1" }],
      }],
    },
  };
  return {
    bytes,
    async getLatestJob(id) { return id === job.id ? structuredClone(job) : null; },
    async listAssetRefs(id) {
      if (id !== job.id) return [];
      return [{
        assetKey: "file:file_fixture_asset",
        objectKey: "asset:fixture-object",
        sizeBytes: bytes.byteLength,
        fileId: "file_fixture_asset",
        fileName: "project-diagram.png",
        mimeType: "image/png",
        sha256: "fixture-sha256",
      }];
    },
    async getAsset(id, assetKey) {
      if (id !== job.id || assetKey !== "file:file_fixture_asset") return null;
      return {
        assetKey,
        objectKey: "asset:fixture-object",
        sizeBytes: bytes.byteLength,
        fileName: "project-diagram.png",
        mimeType: "image/png",
        sha256: "fixture-sha256",
        bytes,
      };
    },
  };
}

test("knowledge export plans and builds Vault volumes with sequential conversation reads", async () => {
  const baseStore = await createProjectStore(5);
  let active = 0;
  let maxActive = 0;
  let reads = 0;
  const store = {
    ...baseStore,
    async exportAgentRecords() { throw new Error("bulk export must not be used by Obsidian export"); },
    async getConversationDetail(key) {
      active += 1;
      reads += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      try { return await baseStore.getConversationDetail(key); }
      finally { active -= 1; }
    },
  };
  const plan = await createKnowledgeExportPlan({
    store,
    projectId: "project-obsidian",
    maxVolumeBytes: 4096,
    generatedAt: "2026-07-26T12:00:00.000Z",
  });
  assert.equal(plan.graphValidation.ok, true);
  assert.equal(plan.vault.report.status, "COMPLETE");
  assert.equal(plan.conversations.length, 5);
  assert(plan.volumeCount >= 2);
  assert.equal(maxActive, 1);
  assert.equal(reads, 5, "planning must measure one conversation at a time");

  const allPaths = new Set();
  for (let number = 1; number <= plan.volumeCount; number += 1) {
    const volume = await buildKnowledgeExportVolume({ plan, volumeNumber: number, store });
    const bytes = new Uint8Array(await volume.blob.arrayBuffer());
    const entries = await readZipEntries(bytes);
    for (const path of entries.keys()) allPaths.add(path);
  }
  assert.equal(maxActive, 1);
  assert([...allPaths].some((path) => path.endsWith("/00 Home/KV Archive Home.md")));
  assert([...allPaths].some((path) => path.endsWith("/80 Canvas/Project Map.canvas")));
  assert.equal([...allPaths].filter((path) => path.includes("/20 Conversations/") && path.endsWith(".md")).length, 5);
});


test("knowledge export materializes locally downloaded project assets without loading binary during preview", async () => {
  const store = await createProjectStore(2);
  const historyStore = createHistoryAssetStore();
  let assetReads = 0;
  const observedHistoryStore = {
    ...historyStore,
    async getAsset(...args) { assetReads += 1; return historyStore.getAsset(...args); },
  };
  const plan = await createKnowledgeExportPlan({
    store,
    historyStore: observedHistoryStore,
    historyJobId: "regular-history-v1",
    projectId: "project-obsidian",
    assetMode: "include",
    generatedAt: "2026-07-26T12:00:00.000Z",
  });
  assert.equal(assetReads, 0, "preview must inspect attachment metadata without loading binary payloads");
  assert.equal(plan.assetStats.materialized, 1);
  assert.equal(plan.assetStats.missing, 0);
  assert.equal(plan.assets.length, 1);
  assert(plan.graph.nodes.some((node) => node.kind === "asset"));
  assert.match(plan.assets[0].path, /^90 Attachments\//);

  const assetVolume = plan.volumes.find((volume) => volume.assetNodeIds.length > 0);
  assert(assetVolume);
  const built = await buildKnowledgeExportVolume({
    plan,
    volumeNumber: assetVolume.number,
    store,
    historyStore: observedHistoryStore,
  });
  assert.equal(assetReads, 1);
  const entries = await readZipEntries(new Uint8Array(await built.blob.arrayBuffer()));
  const assetPath = [...entries.keys()].find((path) => path.includes("/90 Attachments/") && path.endsWith(".png"));
  assert(assetPath);
  assert.deepEqual(entries.get(assetPath), historyStore.bytes);
});

test("knowledge export profiles preserve stable paths and resumable volume state", async () => {
  const store = await createProjectStore(2);
  const first = await createKnowledgeExportPlan({ store, projectId: "project-obsidian", generatedAt: "2026-07-26T12:00:00.000Z" });
  await store.saveKnowledgeExportProfile(first.projectId, { graphHash: first.graphHash, updatedAt: first.generatedAt }, first.vault.pathMap);
  const second = await createKnowledgeExportPlan({ store, projectId: "project-obsidian", generatedAt: "2026-07-27T12:00:00.000Z" });
  assert.deepEqual(Object.fromEntries(Object.entries(second.vault.pathMap).map(([id,row])=>[id,row.path])), Object.fromEntries(Object.entries(first.vault.pathMap).map(([id,row])=>[id,row.path])));
  assert.equal(second.vault.report.reusedPaths, Object.keys(first.vault.pathMap).length);

  const run = resumableKnowledgeRun(second);
  run.completedVolumes = [1];
  run.status = "paused";
  await store.saveKnowledgeExportRun(run);
  const restored = resumableKnowledgeRun(second, await store.getLatestKnowledgeExportRun(second.projectId));
  assert.deepEqual(restored.completedVolumes, [1]);
  assert.equal(restored.id, run.id);
});

test("extension exposes Obsidian Knowledge Graph Export Center", async () => {
  const manifest = JSON.parse(await readFile("apps/extension/src/manifest.json", "utf8"));
  assert.equal(manifest.version, "0.16.11");
  const html = await readFile("apps/extension/src/knowledge.html", "utf8");
  for (const id of ["project","structure","content","asset-mode","volume-size","preview","export","pause","copy-agent","summary","assets","asset-missing"]) assert.match(html, new RegExp(`id=["']${id}["']`));
  const source = await readFile("apps/extension/src/knowledge-export.js", "utf8");
  assert.match(source, /listProjectConversationRefs/);
  assert.match(source, /getConversationDetail/);
  assert.doesNotMatch(source, /exportAgentRecords|getAll\(/);
  const popup = await readFile("apps/extension/src/popup.html", "utf8");
  assert.match(popup, /id="knowledge"/);
});


test("knowledge export includes editable content and supports a notes-only Project", async () => {
  const store = createMemoryLibraryStore();
  const captureStore = createMemoryCaptureStore();
  const first = await captureStore.create({
    kind: "note", projectId: "project-notes", projectTitle: "Notes Only",
    title: "Architecture note", body: "Raw evidence remains immutable; editable notes live separately.",
    tags: ["architecture"],
  }, { id: "note-architecture", now: "2026-07-29T01:00:00.000Z" });
  const second = await captureStore.create({
    kind: "flash", projectId: "project-notes", projectTitle: "Notes Only",
    title: "Next check", body: "Verify graph export.",
  }, { id: "flash-next", now: "2026-07-29T01:01:00.000Z" });
  await captureStore.link({ fromId: second.id, toId: first.id, relation: "depends_on" }, { now: "2026-07-29T01:02:00.000Z" });

  const plan = await createKnowledgeExportPlan({
    store, captureStore, projectId: "project-notes", generatedAt: "2026-07-29T01:03:00.000Z",
  });
  assert.equal(plan.conversations.length, 0);
  assert.equal(plan.contentObjects.length, 2);
  assert.equal(plan.contentRelations.length, 1);
  assert(plan.graph.nodes.some((node) => node.id === "content:project-notes:note-architecture"));
  assert(plan.graph.edges.some((edge) => edge.relation === "depends_on"));
  const contentEntries = plan.vault.entries.filter((entry) => entry.path.startsWith("70 Content/") && entry.path.endsWith(".md"));
  assert.equal(contentEntries.length, 2);
  assert.match(contentEntries.find((entry) => entry.nodeId === "content:project-notes:note-architecture").data, /editable notes live separately/);

  const volume = await buildKnowledgeExportVolume({ plan, volumeNumber: 1, store });
  const entries = await readZipEntries(new Uint8Array(await volume.blob.arrayBuffer()));
  assert.equal([...entries.keys()].filter((path) => path.includes("/70 Content/") && path.endsWith(".md")).length, 2);
});
