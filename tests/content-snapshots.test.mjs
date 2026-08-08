import assert from "node:assert/strict";
import test from "node:test";
import {
  createLogicalSnapshot,
  expandReferencedObjectKeys,
  selectSnapshotsToRetain,
  snapshotReferenceKeys,
} from "../apps/extension/src/content-snapshots.js";

function makeJob() {
  return {
    id: "regular-history-v1",
    status: "completed",
    completedAt: "2026-07-26T00:00:00.000Z",
    accountContext: { workspaceId: null, workspaceLabel: "个人空间" },
    conversations: [
      { id: "c1", title: "One", updateTime: 2, locations: [{ type: "regular", present: true }] },
      { id: "deleted", title: "Deleted", updateTime: 1, locations: [{ type: "regular", present: false }] },
    ],
    projects: [],
    assets: { inventory: [] },
    stats: { incrementalBytesReused: 4096, incrementalNodesReused: 12, incrementalObjectsInserted: 3, incrementalObjectsReused: 13 },
  };
}

function memoryStores() {
  let artifactRefs = [
    { conversationId: "c1", objectKey: "conversation:c1", sizeBytes: 100 },
    { conversationId: "deleted", objectKey: "conversation:deleted", sizeBytes: 999 },
  ];
  let assetRefs = [
    { assetKey: "a1", objectKey: "asset:shared", sizeBytes: 50, sha256: "shared" },
    { assetKey: "a2", objectKey: "asset:shared", sizeBytes: 50, sha256: "shared" },
  ];
  let currentKeys = ["conversation:c1", "asset:shared"];
  const snapshots = [];
  const deletedObjects = [];
  const objects = new Map([
    ["conversation:c1", { key: "conversation:c1", sizeBytes: 100 }],
    ["conversation:deleted", { key: "conversation:deleted", sizeBytes: 999 }],
    ["asset:shared", { key: "asset:shared", sizeBytes: 50 }],
  ]);
  const historyStore = {
    async listArtifactRefs() { return structuredClone(artifactRefs); },
    async listAssetRefs() { return structuredClone(assetRefs); },
    async listCurrentObjectKeys() { return [...currentKeys]; },
  };
  const snapshotStore = {
    async listSnapshots({ jobId = null, accountKey = null } = {}) {
      return snapshots
        .filter((item) => (!jobId || item.jobId === jobId) && (!accountKey || item.accountKey === accountKey))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((item) => structuredClone(item));
    },
    async saveSnapshot(snapshot) { snapshots.push(structuredClone(snapshot)); return snapshot; },
    async deleteSnapshot(id) { const index = snapshots.findIndex((item) => item.id === id); if (index >= 0) snapshots.splice(index, 1); },
    async listContentObjectMetadata() { return [...objects.values()].map((item) => structuredClone(item)); },
    async deleteContentObject(key) { deletedObjects.push(key); objects.delete(key); },
  };
  return {
    historyStore,
    snapshotStore,
    snapshots,
    deletedObjects,
    setArtifactRefs(value) { artifactRefs = value; },
    setAssetRefs(value) { assetRefs = value; },
    setCurrentKeys(value) { currentKeys = value; },
    addObject(value) { objects.set(value.key, value); },
  };
}

test("logical snapshot excludes absent conversations and counts shared objects once", async () => {
  const stores = memoryStores();
  const result = await createLogicalSnapshot({
    ...stores,
    job: makeJob(),
    createdAt: new Date("2026-07-26T00:00:00Z"),
    retention: { maxSnapshots: 30, maxAgeDays: 180 },
  });
  assert.equal(result.created, true);
  assert.deepEqual(result.snapshot.conversations.map((item) => item.conversationId), ["c1"]);
  assert.equal(result.snapshot.assets.length, 2);
  assert.equal(result.snapshot.stats.logicalBytes, 200);
  assert.equal(result.snapshot.stats.physicalReferencedBytes, 150);
  assert.equal(result.snapshot.stats.dedupSavedBytes, 50);
  assert.equal(result.snapshot.stats.incrementalBytesReused, 4096);
  assert.equal(result.snapshot.stats.incrementalNodesReused, 12);
  assert.deepEqual(result.snapshot.delta.conversations.added, ["c1"]);
  assert.deepEqual(result.snapshot.delta.assets.added, ["a1", "a2"]);
  assert.deepEqual([...snapshotReferenceKeys(result.snapshot)].sort(), ["asset:shared", "conversation:c1"]);
});

test("identical state does not create duplicate logical snapshots", async () => {
  const stores = memoryStores();
  const first = await createLogicalSnapshot({ ...stores, job: makeJob(), createdAt: new Date("2026-07-26T00:00:00Z") });
  const second = await createLogicalSnapshot({ ...stores, job: makeJob(), createdAt: new Date("2026-07-27T00:00:00Z") });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.unchanged, true);
  assert.equal(stores.snapshots.length, 1);
});

test("retention removes old snapshots and garbage-collects only unreferenced objects", async () => {
  const stores = memoryStores();
  const job = makeJob();
  await createLogicalSnapshot({ ...stores, job, createdAt: new Date("2026-07-20T00:00:00Z"), retention: { maxSnapshots: 2, maxAgeDays: 365 } });

  stores.setArtifactRefs([{ conversationId: "c1", objectKey: "conversation:c2", sizeBytes: 110 }]);
  stores.setCurrentKeys(["conversation:c2", "asset:shared"]);
  stores.addObject({ key: "conversation:c2", sizeBytes: 110 });
  job.conversations[0].updateTime = 3;
  await createLogicalSnapshot({ ...stores, job, createdAt: new Date("2026-07-21T00:00:00Z"), retention: { maxSnapshots: 2, maxAgeDays: 365 } });

  stores.setArtifactRefs([{ conversationId: "c1", objectKey: "conversation:c3", sizeBytes: 120 }]);
  stores.setCurrentKeys(["conversation:c3", "asset:shared"]);
  stores.addObject({ key: "conversation:c3", sizeBytes: 120 });
  job.conversations[0].updateTime = 4;
  const third = await createLogicalSnapshot({ ...stores, job, createdAt: new Date("2026-07-22T00:00:00Z"), retention: { maxSnapshots: 2, maxAgeDays: 365 } });

  assert.equal(stores.snapshots.length, 2);
  assert.equal(third.retention.deleted.length, 1);
  assert.ok(stores.deletedObjects.includes("conversation:c1"));
  assert.ok(!stores.deletedObjects.includes("conversation:c2"));
  assert.ok(!stores.deletedObjects.includes("asset:shared"));
});

test("snapshot retention always keeps the latest snapshot", () => {
  const snapshots = [
    { id: "new", createdAt: "2026-07-26T00:00:00Z" },
    { id: "old", createdAt: "2020-01-01T00:00:00Z" },
  ];
  const result = selectSnapshotsToRetain(snapshots, { maxSnapshots: 1, maxAgeDays: 1 }, new Date("2026-07-27T00:00:00Z"));
  assert.deepEqual(result.keep.map((item) => item.id), ["new"]);
  assert.deepEqual(result.remove.map((item) => item.id), ["old"]);
});


test("retention and garbage collection stay isolated across account snapshots", async () => {
  const stores = memoryStores();
  stores.snapshots.push({
    id: "foreign", jobId: "regular-history-v1", accountKey: "workspace-foreign",
    createdAt: "2026-07-19T00:00:00Z", conversations: [{ conversationId: "f", objectKey: "conversation:foreign" }], assets: [], projects: [],
  });
  stores.addObject({ key: "conversation:foreign", sizeBytes: 77 });
  const result = await createLogicalSnapshot({
    ...stores, job: makeJob(), createdAt: new Date("2026-07-26T00:00:00Z"),
    retention: { maxSnapshots: 1, maxAgeDays: 1 },
  });
  assert.equal(result.created, true);
  assert.ok(stores.snapshots.some((item) => item.id === "foreign"));
  assert.ok(!stores.deletedObjects.includes("conversation:foreign"));
});


test("transitive content-object references keep mapping chunks and conversation nodes alive", () => {
  const objects = [
    { key: "conversation-manifest:m1", kind: "conversation-manifest", references: ["conversation-map-chunk:c1"] },
    { key: "conversation-map-chunk:c1", kind: "conversation-map-chunk", references: ["conversation-node:n1", "conversation-node:n2"] },
    { key: "conversation-node:n1", kind: "conversation-node" },
    { key: "conversation-node:n2", kind: "conversation-node" },
    { key: "conversation-map-chunk:orphan", kind: "conversation-map-chunk", references: ["conversation-node:orphan"] },
    { key: "conversation-node:orphan", kind: "conversation-node" },
  ];
  const referenced = expandReferencedObjectKeys(new Set(["conversation-manifest:m1"]), objects);
  assert.deepEqual([...referenced].sort(), [
    "conversation-manifest:m1",
    "conversation-map-chunk:c1",
    "conversation-node:n1",
    "conversation-node:n2",
  ]);
  assert.equal(referenced.has("conversation-map-chunk:orphan"), false);
  assert.equal(referenced.has("conversation-node:orphan"), false);
});
