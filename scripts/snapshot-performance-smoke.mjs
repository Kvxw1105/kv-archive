import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createLogicalSnapshot } from "../apps/extension/src/content-snapshots.js";

const outputPath = process.argv[2] || ".tmp/snapshot-performance-smoke.json";
const conversationCount = 3000;
const assetReferenceCount = 600;
const uniqueAssetCount = 120;
const changedConversationCount = 200;

let artifactRefs = Array.from({ length: conversationCount }, (_, index) => ({
  conversationId: `conversation-${index}`,
  objectKey: `conversation:version-1-${index}`,
  sizeBytes: 4096,
}));
const assetRefs = Array.from({ length: assetReferenceCount }, (_, index) => ({
  assetKey: `asset-reference-${index}`,
  objectKey: `asset:shared-${index % uniqueAssetCount}`,
  sizeBytes: 8192,
  sha256: `shared-${index % uniqueAssetCount}`,
}));
let currentKeys = [...artifactRefs.map((item) => item.objectKey), ...new Set(assetRefs.map((item) => item.objectKey))];
const objects = new Map(currentKeys.map((key) => [key, { key, sizeBytes: key.startsWith("asset:") ? 8192 : 4096 }]));
const snapshots = [];
const deletedObjects = [];
const job = {
  id: "regular-history-v1",
  status: "completed",
  completedAt: "2026-07-26T00:00:00Z",
  accountContext: { workspaceId: null, workspaceLabel: "个人空间" },
  conversations: Array.from({ length: conversationCount }, (_, index) => ({
    id: `conversation-${index}`,
    title: `Conversation ${index}`,
    updateTime: 1,
    locations: [{ type: "regular", present: true }],
  })),
  projects: [],
  assets: { inventory: [] },
};
const historyStore = {
  async listArtifactRefs() { return artifactRefs; },
  async listAssetRefs() { return assetRefs; },
  async listCurrentObjectKeys() { return currentKeys; },
};
const snapshotStore = {
  async listSnapshots({ jobId = null, accountKey = null } = {}) {
    return snapshots.filter((item) => (!jobId || item.jobId === jobId) && (!accountKey || item.accountKey === accountKey)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async saveSnapshot(snapshot) { snapshots.push(snapshot); return snapshot; },
  async deleteSnapshot(id) { const index = snapshots.findIndex((item) => item.id === id); if (index >= 0) snapshots.splice(index, 1); },
  async listContentObjectMetadata() { return [...objects.values()]; },
  async deleteContentObject(key) { deletedObjects.push(key); objects.delete(key); },
};

const memory = () => process.memoryUsage().heapUsed;
if (global.gc) global.gc();
const baselineHeap = memory();
let peakHeap = baselineHeap;
const timed = async (operation) => {
  const started = performance.now();
  const result = await operation();
  peakHeap = Math.max(peakHeap, memory());
  return { result, elapsedMs: Math.round((performance.now() - started) * 100) / 100 };
};
const retention = { maxSnapshots: 1, maxAgeDays: 365 };
const first = await timed(() => createLogicalSnapshot({ historyStore, snapshotStore, job, createdAt: new Date("2026-07-26T00:00:00Z"), retention }));
const unchanged = await timed(() => createLogicalSnapshot({ historyStore, snapshotStore, job, createdAt: new Date("2026-07-27T00:00:00Z"), retention }));

artifactRefs = artifactRefs.map((item, index) => index < changedConversationCount
  ? { ...item, objectKey: `conversation:version-2-${index}`, sizeBytes: 4200 }
  : item);
for (let index = 0; index < changedConversationCount; index += 1) {
  job.conversations[index].updateTime = 2;
  objects.set(`conversation:version-2-${index}`, { key: `conversation:version-2-${index}`, sizeBytes: 4200 });
}
currentKeys = [...artifactRefs.map((item) => item.objectKey), ...new Set(assetRefs.map((item) => item.objectKey))];
const changed = await timed(() => createLogicalSnapshot({ historyStore, snapshotStore, job, createdAt: new Date("2026-07-28T00:00:00Z"), retention }));
if (global.gc) global.gc();
const endingHeap = memory();

if (!first.result.created) throw new Error("first snapshot was not created");
if (unchanged.result.created || !unchanged.result.unchanged) throw new Error("unchanged snapshot was duplicated");
if (!changed.result.created) throw new Error("changed snapshot was not created");
if (snapshots.length !== 1) throw new Error(`retention failed: ${snapshots.length} snapshots remain`);
if (deletedObjects.length !== changedConversationCount) throw new Error(`expected ${changedConversationCount} reclaimed objects, got ${deletedObjects.length}`);

const report = {
  conversationCount,
  assetReferenceCount,
  uniqueAssetCount,
  changedConversationCount,
  firstSnapshotMs: first.elapsedMs,
  unchangedCheckMs: unchanged.elapsedMs,
  changedSnapshotMs: changed.elapsedMs,
  logicalBytes: changed.result.snapshot.stats.logicalBytes,
  physicalReferencedBytes: changed.result.snapshot.stats.physicalReferencedBytes,
  dedupSavedBytes: changed.result.snapshot.stats.dedupSavedBytes,
  conversationChanges: changed.result.snapshot.stats.conversationChanges,
  snapshotsRemaining: snapshots.length,
  objectsReclaimed: deletedObjects.length,
  heapPeakDeltaBytes: peakHeap - baselineHeap,
  heapEndingDeltaBytes: endingHeap - baselineHeap,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
