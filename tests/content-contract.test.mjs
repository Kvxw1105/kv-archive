import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPromotionDraft,
  contentEvidenceUri,
  createContentRelation,
  normalizeContentObject,
  parseContentEvidenceUri,
  updateContentObject,
  validateContentObject,
} from "../dist/packages/content-contract/src/index.js";
import { createMemoryCaptureStore } from "../apps/extension/dist/capture-store.js";

test("normalizes a provider-neutral content object with stable evidence URI", async () => {
  const object=await normalizeContentObject({id:"n-1",kind:"note",projectId:"p",title:"Note",body:"Body",tags:["x","x"],source:{rawObjectKey:"conversation:abc"}},{now:"2026-07-29T00:00:00.000Z"});
  assert.equal(object.revision,1);
  assert.deepEqual(object.tags,["x"]);
  assert.equal(validateContentObject(object).ok,true);
  const uri=contentEvidenceUri(object);
  assert.deepEqual(parseContentEvidenceUri(uri),{uri,objectId:"n-1",revision:1,contentHash:object.contentHash});
});

test("updates create immutable versions and reject stale revisions", async () => {
  const first=await normalizeContentObject({id:"n-2",title:"First",body:"A"},{now:"2026-07-29T00:00:00.000Z"});
  const result=await updateContentObject(first,{body:"B"},{expectedRevision:1,now:"2026-07-29T00:01:00.000Z"});
  assert.equal(result.object.revision,2);
  assert.equal(result.version.revision,2);
  assert.notEqual(result.object.contentHash,first.contentHash);
  await assert.rejects(()=>updateContentObject(result.object,{body:"C"},{expectedRevision:1}),/revision conflict/);
});

test("typed relations and promotions remain review-required", async () => {
  const source=await normalizeContentObject({id:"n-3",kind:"flash",projectId:"p",projectTitle:"Project",title:"Decide local-first",body:"Keep the archive local."},{now:"2026-07-29T00:00:00.000Z"});
  const relation=createContentRelation({fromId:"n-3",toId:"n-4",relation:"supports",projectId:"p"},"2026-07-29T00:02:00.000Z");
  assert.equal(relation.relation,"supports");
  const promotion=buildPromotionDraft(source,"decision",{baseVersion:2,now:"2026-07-29T00:03:00.000Z"});
  assert.equal(promotion.status,"pending_review");
  assert.equal(promotion.draft.kind,"decision");
  assert.match(promotion.sourceEvidenceUri,/^contextvault:\/\/content\//);
});

test("memory capture store preserves versions, operations and relations", async () => {
  const store=createMemoryCaptureStore();
  const a=await store.create({id:"a",projectId:"p",title:"A",body:"one"},{now:"2026-07-29T00:00:00.000Z"});
  await store.create({id:"b",projectId:"p",title:"B",body:"two"},{now:"2026-07-29T00:00:01.000Z"});
  await store.update("a",{body:"changed"},{expectedRevision:a.revision,now:"2026-07-29T00:01:00.000Z"});
  await store.link({fromId:"a",toId:"b",relation:"related_to"},{now:"2026-07-29T00:02:00.000Z"});
  assert.equal((await store.listVersions("a")).length,2);
  assert.equal((await store.listOperations({objectId:"a"})).length,3);
  assert.equal((await store.listRelations("a")).length,1);
  const promotion=await store.createPromotion("a","task",{baseVersion:1,now:"2026-07-29T00:03:00.000Z"});
  assert.equal(promotion.targetKind,"task");
  assert.equal((await store.listOperations({objectId:"a"})).length,4);
  await store.create({id:"outside",projectId:"other",title:"Outside",body:"other"},{now:"2026-07-29T00:04:00.000Z"});
  await assert.rejects(()=>store.link({fromId:"a",toId:"outside",relation:"related_to"}),/Cross-Project/);
  const exported=await store.exportRecords({projectId:"p"});
  assert.equal(exported.contentObjects.length,2);
  assert.equal(exported.contentVersions.length,3);
  assert.equal(exported.contentRelations.length,1);
  assert.equal(exported.contentPromotions.length,1);
  assert.equal(exported.contentOperations.length,5);
});
