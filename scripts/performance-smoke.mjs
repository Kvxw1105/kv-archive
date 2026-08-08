import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildLowMemoryHistoryArchiveVolume, createLowMemoryHistoryArchivePlan } from "../apps/extension/dist/history-archive.js";
import { readZipEntries } from "../apps/extension/dist/zip-reader.js";

const conversationCount = Number(process.env.CV_STRESS_CONVERSATIONS || 1200);
const textBytes = Number(process.env.CV_STRESS_TEXT_BYTES || 8192);
const targetVolumeBytes = Number(process.env.CV_STRESS_VOLUME_BYTES || 8 * 1024 * 1024);
const payload = "资".repeat(Math.ceil(textBytes / 3));
function raw(id) {
  return { id, title: `Large ${id}`, create_time: 1, update_time: 2, current_node: `${id}-a`, mapping: {
    [`${id}-u`]: { id: `${id}-u`, parent: null, children: [`${id}-a`], message: { id: `${id}-m1`, author: { role: "user" }, create_time: 1, content: { content_type: "text", parts: [payload] }, metadata: {} } },
    [`${id}-a`]: { id: `${id}-a`, parent: `${id}-u`, children: [], message: { id: `${id}-m2`, author: { role: "assistant" }, create_time: 2, content: { content_type: "text", parts: [payload] }, metadata: {} } },
  } };
}
function meta(id, index) { return { id, title: `Large ${id}`, createTime: 1, updateTime: 2 + index, locations: [{ type: "regular", present: true, projectId: null, projectTitle: null, workspaceId: null }] }; }
const ids = Array.from({ length: conversationCount }, (_, index) => `stress-${String(index).padStart(5, "0")}`);
const artifacts = new Map(ids.map((id, index) => [id, { conversationId: id, title: `Large ${id}`, metadata: meta(id, index), raw: raw(id) }]));
let currentReads = 0;
let maxConcurrentReads = 0;
const store = {
  async listArtifactIds() { return ids; },
  async getArtifact(_jobId, id) { currentReads += 1; maxConcurrentReads = Math.max(maxConcurrentReads, currentReads); const value = structuredClone(artifacts.get(id)); currentReads -= 1; return value; },
  async listAssetMetadata() { return []; },
  async getAsset() { return null; },
  async listArtifacts() { throw new Error("bulk artifact loader called"); },
  async listAssets() { throw new Error("bulk asset loader called"); },
};
const job = { id: "stress-job", scope: "all-conversations", accountContext: { workspaceId: null, workspaceLabel: "压力测试" }, conversations: ids.map(meta), projects: [], failures: [], warnings: [], completedAt: "2026-07-26T00:00:00.000Z", updatedAt: "2026-07-26T00:00:00.000Z", stats: { regular: conversationCount, archived: 0, projects: 0, projectConversations: 0, completed: conversationCount, failed: 0 }, assets: { inventory: [], completedKeys: [], failures: [], unsupportedKeys: [] } };
const sample = () => { const m = process.memoryUsage(); return { heapUsed: m.heapUsed, heapTotal: m.heapTotal, rss: m.rss, external: m.external }; };
const baseline = sample();
let peak = { ...baseline };
const updatePeak = () => { const m = sample(); for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], m[key]); };
const startedAt = Date.now();
const plan = await createLowMemoryHistoryArchivePlan({ store, job, generatedAt: new Date("2026-07-26T00:00:00Z"), maxVolumeBytes: targetVolumeBytes, onProgress: updatePeak });
updatePeak();
const volumes = [];
for (let number = 1; number <= plan.volumeCount; number += 1) {
  let built = await buildLowMemoryHistoryArchiveVolume({ plan, volumeNumber: number, store, job, onProgress: updatePeak });
  updatePeak();
  volumes.push({ number, sizeBytes: built.sizeBytes, entryCount: built.entryCount });
  if (number === 1 || number === plan.volumeCount) {
    const entries = await readZipEntries(new Uint8Array(await built.blob.arrayBuffer()), { maxEntries: 10000, maxTotalUncompressedBytes: 128 * 1024 * 1024 });
    if (number === 1 && !entries.has("index.html")) throw new Error("first volume missing index.html");
  }
  built = null;
  if (global.gc) global.gc();
  updatePeak();
}
const result = {
  conversationCount,
  approximateSourceTextBytes: conversationCount * textBytes * 2,
  targetVolumeBytes,
  volumeCount: plan.volumeCount,
  largestVolumeBytes: Math.max(...volumes.map((item) => item.sizeBytes)),
  smallestVolumeBytes: Math.min(...volumes.map((item) => item.sizeBytes)),
  totalZipBytes: volumes.reduce((sum, item) => sum + item.sizeBytes, 0),
  maxConcurrentArtifactReads: maxConcurrentReads,
  elapsedMs: Date.now() - startedAt,
  baseline,
  peak,
  peakHeapDeltaBytes: peak.heapUsed - baseline.heapUsed,
  peakRssDeltaBytes: peak.rss - baseline.rss,
  volumes,
};
const outputPath = process.argv[2] || ".tmp/performance-smoke.json";
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
