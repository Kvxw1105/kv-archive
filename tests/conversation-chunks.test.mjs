import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  CONVERSATION_MANIFEST_SCHEMA,
  buildConversationStoragePlan,
  manifestReferencedObjectKeys,
  restoreConversationFromManifest,
} from "../apps/extension/src/conversation-chunks.js";

async function fixture() {
  return JSON.parse(await readFile("fixtures/synthetic/multi-branch-conversation.json", "utf8"));
}

function manifestRecord(plan) {
  return plan.records.find((record) => record.kind === "conversation-manifest");
}

function nodeKeyMap(plan) {
  const records = new Map(plan.records.map((record) => [record.key, record]));
  const manifest = manifestRecord(plan)?.payload;
  const mapping = manifest?.entries?.find((entry) => entry.type === "mapping");
  const entries = [];
  for (const chunkKey of mapping?.chunks ?? []) entries.push(...(records.get(chunkKey)?.payload?.entries ?? []));
  return new Map(entries);
}

test("chunked conversation manifest reconstructs the exact raw mapping graph", async () => {
  const raw = await fixture();
  const plan = await buildConversationStoragePlan(raw);
  assert.equal(plan.mode, "mapping-node-chunks-v2");
  assert.equal(plan.nodeCount, Object.keys(raw.mapping).length);
  const manifest = manifestRecord(plan);
  assert.equal(manifest.payload.schema, CONVERSATION_MANIFEST_SCHEMA);
  assert.deepEqual(manifest.references, manifestReferencedObjectKeys(manifest.payload));
  const objects = new Map(plan.records.map((record) => [record.key, record]));
  const reconstructed = restoreConversationFromManifest(manifest.payload, objects);
  assert.deepEqual(reconstructed, raw);
  assert.deepEqual(Object.keys(reconstructed), Object.keys(raw), "top-level key order stays stable for legacy render/export paths");
  assert.deepEqual(Object.keys(reconstructed.mapping), Object.keys(raw.mapping), "mapping node order stays stable");
});

test("appending messages reuses unchanged node objects instead of duplicating the whole conversation", async () => {
  const before = await fixture();
  const after = structuredClone(before);
  const previousLeaf = after.current_node;
  after.mapping[previousLeaf].children = ["user-2"];
  after.mapping["user-2"] = {
    id: "user-2",
    parent: previousLeaf,
    children: ["assistant-2"],
    message: {
      id: "msg-user-2",
      author: { role: "user" },
      create_time: 1785031810,
      content: { content_type: "text", parts: ["Continue this conversation today."] },
      metadata: {},
    },
  };
  after.mapping["assistant-2"] = {
    id: "assistant-2",
    parent: "user-2",
    children: [],
    message: {
      id: "msg-assistant-2",
      author: { role: "assistant" },
      create_time: 1785031820,
      content: { content_type: "text", parts: ["This is the newly appended answer."] },
      metadata: {},
    },
  };
  after.current_node = "assistant-2";
  after.update_time += 100;

  const first = await buildConversationStoragePlan(before);
  const second = await buildConversationStoragePlan(after);
  const firstNodes = nodeKeyMap(first);
  const secondNodes = nodeKeyMap(second);

  for (const nodeId of Object.keys(before.mapping)) {
    if (nodeId === previousLeaf) assert.notEqual(secondNodes.get(nodeId), firstNodes.get(nodeId), "the prior leaf changes when it gains a child");
    else assert.equal(secondNodes.get(nodeId), firstNodes.get(nodeId), `unchanged node ${nodeId} must reuse its content object`);
  }
  assert.ok(secondNodes.get("user-2"));
  assert.ok(secondNodes.get("assistant-2"));
  assert.notEqual(second.objectKey, first.objectKey, "the small manifest changes to point at the new graph state");

  const firstKeys = new Set(first.records.map((record) => record.key));
  const newlyRequired = second.records.filter((record) => !firstKeys.has(record.key));
  assert.equal(newlyRequired.filter((record) => record.kind === "conversation-node").length, 3, "only the changed prior leaf and two appended nodes need new node objects");
  assert.equal(newlyRequired.filter((record) => record.kind === "conversation-map-chunk").length, 1, "only the tail reference chunk changes for this append");
  assert.equal(newlyRequired.filter((record) => record.kind === "conversation-manifest").length, 1);
});

test("non-mapping provider payloads retain the legacy whole-object fallback", async () => {
  const raw = { id: "provider-generic", messages: [{ role: "user", text: "hello" }] };
  const plan = await buildConversationStoragePlan(raw);
  assert.equal(plan.mode, "whole-conversation-v1");
  assert.equal(plan.records.length, 1);
  assert.equal(plan.records[0].kind, "conversation");
  assert.deepEqual(plan.records[0].payload, raw);
});
