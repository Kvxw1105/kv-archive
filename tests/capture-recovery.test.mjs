import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryCaptureStore } from "../apps/extension/dist/capture-store.js";
import {
  buildPortableCapturePackage,
  createPortableCaptureZip,
  planPortableCaptureImport,
  readPortableCaptureZip,
  validatePortableCapturePackage,
} from "../apps/extension/dist/capture-package.js";

async function seededStore() {
  const store = createMemoryCaptureStore();
  const a = await store.create({ id: "note-a", projectId: "project-a", projectTitle: "Project A", title: "A", body: "first" }, { now: "2026-07-29T00:00:00.000Z" });
  await store.create({ id: "note-b", projectId: "project-a", projectTitle: "Project A", title: "B", body: "second" }, { now: "2026-07-29T00:00:01.000Z" });
  await store.update("note-a", { body: "first updated" }, { expectedRevision: a.revision, now: "2026-07-29T00:01:00.000Z" });
  await store.link({ fromId: "note-a", toId: "note-b", relation: "supports" }, { now: "2026-07-29T00:02:00.000Z" });
  await store.createPromotion("note-a", "task", { baseVersion: 2, now: "2026-07-29T00:03:00.000Z" });
  return store;
}

test("portable capture package is deterministic, validated and ZIP round-trippable", async () => {
  const store = await seededStore();
  const records = await store.exportRecords({ projectId: "project-a" });
  const one = await buildPortableCapturePackage(records, { now: "2026-07-29T01:00:00.000Z", sourceAppVersion: "0.15.0", scope: { projectId: "project-a" } });
  const two = await buildPortableCapturePackage(records, { now: "2026-07-29T02:00:00.000Z", sourceAppVersion: "0.15.0", scope: { projectId: "project-a" } });
  assert.equal(one.payloadHash, two.payloadHash);
  assert.equal(one.packageId, two.packageId);
  const validation = await validatePortableCapturePackage(one);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  const zip = createPortableCaptureZip(one, new Date("2026-07-29T01:00:00.000Z"));
  const parsed = await readPortableCaptureZip(zip);
  assert.equal(parsed.package.payloadHash, one.payloadHash);
  assert.deepEqual(parsed.package.counts, one.counts);
});

test("dry-run import writes nothing, apply creates an append-only receipt, and reimport is a no-op", async () => {
  const source = await seededStore();
  const packageValue = await buildPortableCapturePackage(await source.exportRecords({}), { now: "2026-07-29T01:00:00.000Z" });
  const target = createMemoryCaptureStore();
  const dryRun = await target.analyzePortablePackage(packageValue);
  assert.equal(dryRun.canApply, true);
  assert.equal(dryRun.writeCounts.createObjects, 2);
  assert.equal((await target.list()).length, 0, "dry-run must not write");
  const applied = await target.applyPortablePackage(packageValue, { now: "2026-07-29T01:05:00.000Z" });
  assert.equal(applied.receipt.status, "applied");
  assert.equal((await target.list()).length, 2);
  assert.equal((await target.listRecoveryReceipts()).length, 1);
  const secondPlan = await target.analyzePortablePackage(packageValue);
  assert.equal(secondPlan.canApply, true);
  assert.equal(secondPlan.totalWrites, 0);
  const second = await target.applyPortablePackage(packageValue, { now: "2026-07-29T01:06:00.000Z" });
  assert.equal(second.receipt.status, "no_changes");
  assert.equal((await target.listRecoveryReceipts()).length, 2);
});

test("same id with different project or divergent content blocks import before writing", async () => {
  const source = createMemoryCaptureStore();
  await source.create({ id: "same", projectId: "incoming", title: "Incoming", body: "incoming" }, { now: "2026-07-29T00:00:00.000Z" });
  const packageValue = await buildPortableCapturePackage(await source.exportRecords({}), { now: "2026-07-29T01:00:00.000Z" });
  const target = createMemoryCaptureStore();
  await target.create({ id: "same", projectId: "local", title: "Local", body: "local" }, { now: "2026-07-29T00:00:00.000Z" });
  const plan = await target.analyzePortablePackage(packageValue);
  assert.equal(plan.canApply, false);
  assert.ok(plan.conflicts.some((row) => row.code === "PROJECT_CONFLICT"));
  await assert.rejects(() => target.applyPortablePackage(packageValue), /blocked/);
  assert.equal((await target.get("same")).body, "local");
});

test("lineage-matched object can fast-forward and roll back within the receipt boundary", async () => {
  const source = createMemoryCaptureStore();
  const base = await source.create({ id: "note", projectId: "p", title: "Note", body: "v1" }, { now: "2026-07-29T00:00:00.000Z" });
  await source.update("note", { body: "v2" }, { expectedRevision: base.revision, now: "2026-07-29T00:01:00.000Z" });
  const packageValue = await buildPortableCapturePackage(await source.exportRecords({}), { now: "2026-07-29T01:00:00.000Z" });
  const target = createMemoryCaptureStore();
  await target.create({ id: "note", projectId: "p", title: "Note", body: "v1" }, { now: "2026-07-29T00:00:00.000Z" });
  const plan = await target.analyzePortablePackage(packageValue);
  assert.equal(plan.writeCounts.fastForwardObjects, 1);
  const applied = await target.applyPortablePackage(packageValue, { now: "2026-07-29T01:05:00.000Z" });
  assert.equal((await target.get("note")).body, "v2");
  const rollbackPlan = await target.analyzePortableRollback(applied.receipt.id);
  assert.equal(rollbackPlan.canRollback, true, JSON.stringify(rollbackPlan.conflicts));
  const rolledBack = await target.rollbackPortableImport(applied.receipt.id, { now: "2026-07-29T01:06:00.000Z" });
  assert.equal(rolledBack.receipt.type, "rollback");
  assert.equal((await target.get("note")).body, "v1");
  assert.equal((await target.listRecoveryReceipts()).length, 2);
  const repeated = await target.analyzePortableRollback(applied.receipt.id);
  assert.equal(repeated.canRollback, false);
  assert.ok(repeated.conflicts.some((row) => row.code === "ALREADY_ROLLED_BACK"));
});

test("later local edits block rollback instead of destroying newer work", async () => {
  const source = createMemoryCaptureStore();
  await source.create({ id: "new-note", projectId: "p", title: "New", body: "imported" }, { now: "2026-07-29T00:00:00.000Z" });
  const packageValue = await buildPortableCapturePackage(await source.exportRecords({}), { now: "2026-07-29T01:00:00.000Z" });
  const target = createMemoryCaptureStore();
  const applied = await target.applyPortablePackage(packageValue, { now: "2026-07-29T01:05:00.000Z" });
  const imported = await target.get("new-note");
  await target.update("new-note", { body: "local edit" }, { expectedRevision: imported.revision, now: "2026-07-29T01:06:00.000Z" });
  const rollback = await target.analyzePortableRollback(applied.receipt.id);
  assert.equal(rollback.canRollback, false);
  assert.ok(rollback.conflicts.some((row) => row.code === "OBJECT_CHANGED_AFTER_IMPORT"));
  await assert.rejects(() => target.rollbackPortableImport(applied.receipt.id), /blocked/);
  assert.equal((await target.get("new-note")).body, "local edit");
});

test("tampered package hash is rejected", async () => {
  const store = await seededStore();
  const packageValue = await buildPortableCapturePackage(await store.exportRecords({}), { now: "2026-07-29T01:00:00.000Z" });
  packageValue.records.contentObjects[0].body = "tampered";
  const validation = await validatePortableCapturePackage(packageValue);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((row) => row.code === "CONTENT_HASH_MISMATCH"));
  assert.ok(validation.issues.some((row) => row.code === "PAYLOAD_HASH_MISMATCH"));
  const empty = { contentObjects: [], contentVersions: [], contentRelations: [], contentOperations: [], contentPromotions: [] };
  const plan = await planPortableCaptureImport(packageValue, empty);
  assert.equal(plan.canApply, false);
});


test("new relations or promotions created after import block destructive rollback", async () => {
  const source = createMemoryCaptureStore();
  await source.create({ id: "imported", projectId: "p", title: "Imported", body: "body" }, { now: "2026-07-29T00:00:00.000Z" });
  const packageValue = await buildPortableCapturePackage(await source.exportRecords({}), { now: "2026-07-29T01:00:00.000Z" });
  const target = createMemoryCaptureStore();
  await target.create({ id: "local", projectId: "p", title: "Local", body: "local" }, { now: "2026-07-29T00:30:00.000Z" });
  const applied = await target.applyPortablePackage(packageValue, { now: "2026-07-29T01:05:00.000Z" });
  await target.link({ fromId: "imported", toId: "local", relation: "related_to" }, { now: "2026-07-29T01:06:00.000Z" });
  await target.createPromotion("imported", "task", { baseVersion: 0, now: "2026-07-29T01:07:00.000Z" });
  const rollback = await target.analyzePortableRollback(applied.receipt.id);
  assert.equal(rollback.canRollback, false);
  assert.ok(rollback.conflicts.some((row) => row.code === "DEPENDENT_RELATION_EXISTS"));
  assert.ok(rollback.conflicts.some((row) => row.code === "DEPENDENT_PROMOTION_EXISTS"));
});


test("unbound export scope does not leak Project-bound notes", async () => {
  const store = createMemoryCaptureStore();
  await store.create({ id: "unbound", title: "Loose", body: "loose" }, { now: "2026-07-29T00:00:00.000Z" });
  await store.create({ id: "bound", projectId: "p", title: "Bound", body: "bound" }, { now: "2026-07-29T00:00:01.000Z" });
  const records = await store.exportRecords({ unbound: true });
  assert.deepEqual(records.contentObjects.map((row) => row.id), ["unbound"]);
  const packageValue = await buildPortableCapturePackage(records, { scope: { unbound: true }, now: "2026-07-29T01:00:00.000Z" });
  assert.equal(packageValue.scope.unbound, true);
  assert.equal(packageValue.counts.contentObjects, 1);
});


test("package scope labels are validated against contained objects", async () => {
  const store = createMemoryCaptureStore();
  await store.create({ id: "bound-scope", projectId: "p", title: "Bound", body: "body" }, { now: "2026-07-29T00:00:00.000Z" });
  const packageValue = await buildPortableCapturePackage(await store.exportRecords({}), { scope: { unbound: true }, now: "2026-07-29T01:00:00.000Z" });
  const validation = await validatePortableCapturePackage(packageValue);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((row) => row.code === "SCOPE_UNBOUND_MISMATCH"));
});
