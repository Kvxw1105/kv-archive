import { writeFile } from "node:fs/promises";
import { buildConversationStoragePlan } from "../apps/extension/src/conversation-chunks.js";

const outputPath = process.argv[2] || ".tmp/conversation-chunk-performance.json";
const nodeCount = Math.max(100, Number(process.env.KV_CHUNK_NODES || 10000));

function makeConversation(count) {
  const mapping = {};
  for (let index = 0; index < count; index += 1) {
    const id = `node-${index}`;
    const next = index + 1 < count ? `node-${index + 1}` : null;
    mapping[id] = {
      id,
      parent: index === 0 ? null : `node-${index - 1}`,
      children: next ? [next] : [],
      message: index === 0 ? null : {
        id: `message-${index}`,
        author: { role: index % 2 ? "user" : "assistant" },
        create_time: 1785031200 + index,
        content: { content_type: "text", parts: [`payload ${index} ${"x".repeat(96)}`] },
        metadata: {},
      },
    };
  }
  return {
    id: "long-conversation",
    title: "Long Conversation",
    create_time: 1785031200,
    update_time: 1785031200 + count,
    current_node: `node-${count - 1}`,
    mapping,
  };
}

function nodeKeys(plan) {
  const records = new Map(plan.records.map((record) => [record.key, record]));
  const manifest = plan.records.find((record) => record.kind === "conversation-manifest")?.payload;
  const mapping = manifest.entries.find((entry) => entry.type === "mapping");
  const entries = [];
  for (const chunkKey of mapping?.chunks ?? []) entries.push(...(records.get(chunkKey)?.payload?.entries ?? []));
  return new Map(entries);
}

const before = makeConversation(nodeCount);
const started = performance.now();
const first = await buildConversationStoragePlan(before);
const firstMs = performance.now() - started;

const after = structuredClone(before);
const priorLeaf = after.current_node;
after.mapping[priorLeaf].children = [`node-${nodeCount}`];
for (let offset = 0; offset < 2; offset += 1) {
  const index = nodeCount + offset;
  const id = `node-${index}`;
  after.mapping[id] = {
    id,
    parent: index === nodeCount ? priorLeaf : `node-${index - 1}`,
    children: offset === 0 ? [`node-${index + 1}`] : [],
    message: {
      id: `message-${index}`,
      author: { role: offset === 0 ? "user" : "assistant" },
      create_time: 1785031200 + index,
      content: { content_type: "text", parts: [`new payload ${index} ${"y".repeat(96)}`] },
      metadata: {},
    },
  };
}
after.current_node = `node-${nodeCount + 1}`;
after.update_time += 2;
const secondStarted = performance.now();
const second = await buildConversationStoragePlan(after);
const secondMs = performance.now() - secondStarted;

const firstKeys = nodeKeys(first);
const secondKeys = nodeKeys(second);
let reusedNodes = 0;
for (const [id, key] of firstKeys) if (secondKeys.get(id) === key) reusedNodes += 1;
const newRecordKeys = new Set(first.records.map((record) => record.key));
const newlyRequiredRecords = second.records.filter((record) => !newRecordKeys.has(record.key));
const result = {
  nodeCount,
  appendedNodes: 2,
  reusedNodes,
  reuseRatio: reusedNodes / nodeCount,
  newlyRequiredNodeObjects: newlyRequiredRecords.filter((record) => record.kind === "conversation-node").length,
  newlyRequiredMappingChunks: newlyRequiredRecords.filter((record) => record.kind === "conversation-map-chunk").length,
  newlyRequiredManifests: newlyRequiredRecords.filter((record) => record.kind === "conversation-manifest").length,
  firstPlanMs: Math.round(firstMs),
  updatedPlanMs: Math.round(secondMs),
  rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
};
if (reusedNodes !== nodeCount - 1) throw new Error(`Expected ${nodeCount - 1} reused nodes, got ${reusedNodes}`);
if (result.newlyRequiredNodeObjects !== 3) throw new Error(`Expected 3 new/changed node objects, got ${result.newlyRequiredNodeObjects}`);
if (result.newlyRequiredMappingChunks !== 1) throw new Error(`Expected one changed mapping chunk, got ${result.newlyRequiredMappingChunks}`);
if (result.newlyRequiredManifests !== 1) throw new Error(`Expected one new manifest, got ${result.newlyRequiredManifests}`);
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
