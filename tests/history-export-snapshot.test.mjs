import test from "node:test";
import assert from "node:assert/strict";
import { createSavedHistoryExportSnapshot } from "../apps/extension/dist/history-export-snapshot.js";
import { createLowMemoryHistoryArchivePlan } from "../apps/extension/dist/history-archive.js";

function rawConversation(id) {
  return {
    id,
    title: id,
    current_node: `${id}-a`,
    mapping: {
      [`${id}-u`]: { id: `${id}-u`, parent: null, children: [`${id}-a`], message: { id: `${id}-mu`, author: { role: "user" }, content: { content_type: "text", parts: ["Q"] } } },
      [`${id}-a`]: { id: `${id}-a`, parent: `${id}-u`, children: [], message: { id: `${id}-ma`, author: { role: "assistant" }, content: { content_type: "text", parts: ["A"] } } },
    },
  };
}

function metadata(id, title) {
  return {
    id,
    title,
    createTime: 1,
    updateTime: 2,
    locations: [{ type: "regular", present: true }],
  };
}

function storeWithArtifacts(jobId) {
  const artifacts = new Map([
    ["c-1", { conversationId: "c-1", title: "One", metadata: metadata("c-1", "One"), raw: rawConversation("c-1") }],
    ["c-2", { conversationId: "c-2", title: "Two", metadata: metadata("c-2", "Two"), raw: rawConversation("c-2") }],
  ]);
  return {
    async listArtifactIds(id) { return id === jobId ? [...artifacts.keys()] : []; },
    async getArtifact(id, conversationId) { return id === jobId ? structuredClone(artifacts.get(conversationId) ?? null) : null; },
    async listAssetMetadata() { return []; },
    async getAsset() { return null; },
  };
}

test("saved-history snapshot exports durable progress without mutating the resumable job", async () => {
  const job = {
    id: "conversation-selection:batch",
    scope: "selected-conversations",
    status: "exporting",
    selection: { id: "batch", title: "Large batch", total: 3 },
    conversations: [metadata("c-1", "One"), metadata("c-2", "Two"), metadata("c-3", "Three")],
    completedIds: ["c-1"],
    completedVersions: { "c-1": "2" },
    failures: [{ id: "c-3", error: "temporary" }],
    projects: [],
    assets: { inventory: [], completedKeys: [], failures: [], unsupportedKeys: [] },
    stats: {},
    warnings: [],
    accountContext: { workspaceLabel: "Workspace" },
    assetPolicy: "references-only",
  };
  const store = storeWithArtifacts(job.id);
  const snapshot = await createSavedHistoryExportSnapshot({ job, store, generatedAt: new Date("2026-07-30T07:00:00.000Z") });

  assert.deepEqual(snapshot.completedIds.sort(), ["c-1", "c-2"]);
  assert.equal(snapshot.captureProgress.selectedTotal, 3);
  assert.equal(snapshot.captureProgress.savedCount, 2);
  assert.equal(snapshot.captureProgress.remainingCount, 1);
  assert.equal(snapshot.captureProgress.failedCount, 1);
  assert.equal(snapshot.captureProgress.isPartial, true);
  assert.equal(snapshot.scope, "selected-conversations-partial");
  assert.equal(snapshot.conversations.length, 2);
  assert.deepEqual(job.completedIds, ["c-1"], "source job must remain untouched");

  const plan = await createLowMemoryHistoryArchivePlan({ store, job: snapshot, generatedAt: new Date("2026-07-30T07:00:00.000Z") });
  assert.match(plan.baseName, /Partial-2-of-3$/);
  assert.equal(plan.manifest.captureProgress.savedCount, 2);
  assert.equal(plan.records.length, 2);
});
