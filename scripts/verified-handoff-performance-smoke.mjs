import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { AgentRepository } from "../apps/agent/src/agent-core.js";
import { createVerifiedHandoff, preflightVerifiedHandoffBytes } from "../apps/agent/src/verified-handoff.js";

const output = resolve(process.argv[2] || ".tmp/verified-handoff-performance.json");
const count = Number(process.env.KV_HANDOFF_OBJECTS || 3000);
const projectId = "project-performance-handoff";
const projectTitle = "Performance Handoff";
const now = "2026-07-29T10:00:00.000Z";
const state = {
  format: "kv-archive-project-state",
  schemaVersion: 1,
  projectId,
  projectTitle,
  stateVersion: 1,
  stateHash: "state-performance-handoff",
  updatedAt: now,
  status: { summary: "Verify a large project-scoped handoff package.", phase: "handoff", health: "on_track", progressPercent: 80, blockers: [], nextActions: ["Run receiver preflight"] },
  decisions: [], tasks: [], supersessions: [], lastProposalId: null,
};
const contentObjects = [];
const contentVersions = [];
const contentOperations = [];
for (let index = 0; index < count; index += 1) {
  const id = `note-${String(index).padStart(5, "0")}`;
  const hash = `hash-${String(index).padStart(5, "0")}`;
  contentObjects.push({ id, kind: index % 5 === 0 ? "flash" : "note", projectId, projectTitle, title: `Handoff note ${index}`, body: `note ${index} records the verified handoff recovery and continuity requirements. `.repeat(8), status: "active", revision: 1, contentHash: hash, tags: ["handoff", "performance"], createdAt: now, updatedAt: now });
  contentVersions.push({ key: `${id}:1`, objectId: id, revision: 1, snapshotHash: `snapshot-${hash}`, createdAt: now });
  contentOperations.push({ id: `op-${id}`, objectId: id, projectId, type: "create", resultingRevision: 1, afterHash: hash, createdAt: now });
}
const repository = new AgentRepository({
  manifest: { format: "context-vault-agent-bundle", version: 3, bundleId: "bundle-performance-handoff", createdAt: now, readOnly: true },
  conversations: [], messages: [], evidence: [], states: [state], contentObjects, contentVersions, contentRelations: [], contentOperations, contentPromotions: [],
});
if (global.gc) global.gc();
const before = process.memoryUsage().heapUsed;
const started = performance.now();
const result = createVerifiedHandoff(repository, { project: projectId, query: "note verified handoff", contextBudget: 32768, generatedAt: now });
const createdMs = performance.now() - started;
const preflightStarted = performance.now();
const preflight = preflightVerifiedHandoffBytes(result.receiver.bytes);
const preflightMs = performance.now() - preflightStarted;
if (preflight.status !== "PASS") throw new Error(`Preflight failed: ${JSON.stringify(preflight.failures)}`);
if (preflight.stats.contentObjects !== count) throw new Error(`Expected ${count} content objects, got ${preflight.stats.contentObjects}`);
if (global.gc) global.gc();
const after = process.memoryUsage().heapUsed;
const report = {
  format: "kv-archive-verified-handoff-performance",
  version: 1,
  objectCount: count,
  versionCount: count,
  operationCount: count,
  receiverBytes: result.receiver.bytes.length,
  verificationKitBytes: result.verificationKit.bytes.length,
  contextEstimatedTokens: result.contextPack.estimatedTokens,
  createMilliseconds: Math.round(createdMs * 100) / 100,
  preflightMilliseconds: Math.round(preflightMs * 100) / 100,
  heapDeltaBytes: after - before,
  preflightStatus: preflight.status,
  scopedProjects: preflight.stats.projects,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
