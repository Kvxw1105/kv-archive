import { writeFile, mkdir } from "node:fs/promises";
import { normalizeContentObject, createContentVersion } from "../dist/packages/content-contract/src/index.js";
import { buildPortableCapturePackage, createPortableCaptureZip, planPortableCaptureImport, validatePortableCapturePackage } from "../apps/extension/dist/capture-package.js";

const output = process.argv[2] || ".tmp/capture-recovery-performance.json";
const count = Number(process.env.KV_CAPTURE_OBJECTS || 3000);
const started = performance.now();
const records = { contentObjects: [], contentVersions: [], contentRelations: [], contentOperations: [], contentPromotions: [] };
for (let index = 0; index < count; index += 1) {
  const now = new Date(Date.UTC(2026, 6, 29, 0, 0, index % 60, index % 1000)).toISOString();
  const object = await normalizeContentObject({ id: `note-${String(index).padStart(5, "0")}`, kind: index % 5 === 0 ? "flash" : "note", projectId: `project-${index % 20}`, title: `Note ${index}`, body: `Portable recovery body ${index}\n${"x".repeat(160)}`, tags: [`tag-${index % 10}`] }, { now });
  records.contentObjects.push(object);
  records.contentVersions.push(createContentVersion(object, "create", now));
  records.contentOperations.push({ format: "kv-archive-content-operation", schemaVersion: 1, id: `content-op:${object.id}:1:${now}`, objectId: object.id, projectId: object.projectId, type: "create", expectedRevision: null, resultingRevision: 1, beforeHash: null, afterHash: object.contentHash, actor: "performance-smoke", createdAt: now, details: { kind: object.kind } });
}
const generatedMs = performance.now() - started;
const packageStarted = performance.now();
const packageValue = await buildPortableCapturePackage(records, { now: "2026-07-29T01:00:00.000Z", sourceAppVersion: "0.14.3" });
const validation = await validatePortableCapturePackage(packageValue);
if (!validation.ok) throw new Error(`Package validation failed: ${JSON.stringify(validation.issues.slice(0, 5))}`);
const zip = createPortableCaptureZip(packageValue, new Date("2026-07-29T01:00:00.000Z"));
const plan = await planPortableCaptureImport(packageValue, { contentObjects: [], contentVersions: [], contentRelations: [], contentOperations: [], contentPromotions: [] });
if (!plan.canApply || plan.writeCounts.createObjects !== count) throw new Error("Dry-run plan did not preserve all objects");
const packageMs = performance.now() - packageStarted;
const result = {
  format: "kv-archive-capture-recovery-performance",
  schemaVersion: 1,
  objectCount: count,
  versionCount: records.contentVersions.length,
  operationCount: records.contentOperations.length,
  zipBytes: zip.length,
  generatedMs: Math.round(generatedMs),
  packageValidatePlanMs: Math.round(packageMs),
  totalMs: Math.round(performance.now() - started),
  payloadHash: packageValue.payloadHash,
  canApply: plan.canApply,
  totalWrites: plan.totalWrites,
};
await mkdir(output.slice(0, output.lastIndexOf("/")), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
