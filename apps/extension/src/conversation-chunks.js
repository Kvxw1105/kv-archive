import { byteLengthOf, contentObjectKey } from "./content-hash.js";

export const CONVERSATION_MANIFEST_SCHEMA = "kv-archive/conversation-manifest/v2";
export const CONVERSATION_MAP_CHUNK_SCHEMA = "kv-archive/conversation-map-chunk/v1";
const NODE_KIND = "conversation-node";
const MAP_CHUNK_KIND = "conversation-map-chunk";
const MANIFEST_KIND = "conversation-manifest";

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isChunkableConversation(raw) {
  return isPlainRecord(raw) && isPlainRecord(raw.mapping);
}

function hashFromKey(key) {
  return String(key).split(":").slice(1).join(":");
}

async function buildNodeRecords(mapping, batchSize) {
  const source = Object.entries(mapping);
  const refs = [];
  const records = [];
  const size = Math.max(1, Math.floor(Number(batchSize || 128)));
  for (let offset = 0; offset < source.length; offset += size) {
    const batch = source.slice(offset, offset + size);
    const values = await Promise.all(batch.map(async ([nodeId, node]) => {
      const key = await contentObjectKey(NODE_KIND, node);
      return {
        ref: [nodeId, key],
        record: {
          key,
          kind: NODE_KIND,
          hash: hashFromKey(key),
          sizeBytes: byteLengthOf(node),
          payload: node,
          createdAt: new Date().toISOString(),
        },
      };
    }));
    for (const value of values) {
      refs.push(value.ref);
      records.push(value.record);
    }
  }
  return { refs, records };
}

async function buildMappingChunkRecords(refs, mappingChunkSize) {
  const size = Math.max(16, Math.floor(Number(mappingChunkSize || 256)));
  const chunks = [];
  const records = [];
  for (let offset = 0; offset < refs.length; offset += size) {
    const entries = refs.slice(offset, offset + size);
    const payload = { schema: CONVERSATION_MAP_CHUNK_SCHEMA, entries };
    const key = await contentObjectKey(MAP_CHUNK_KIND, payload);
    chunks.push(key);
    records.push({
      key,
      kind: MAP_CHUNK_KIND,
      hash: hashFromKey(key),
      sizeBytes: byteLengthOf(payload),
      references: [...new Set(entries.map((pair) => pair[1]).filter(Boolean))],
      payload,
      createdAt: new Date().toISOString(),
    });
  }
  return { chunks, records };
}

function lookupRecord(source, key) {
  if (source instanceof Map) return source.get(key);
  return source?.[key];
}

function lookupPayload(source, key) {
  const value = lookupRecord(source, key);
  return value?.payload ?? value;
}

export function manifestReferencedObjectKeys(payload) {
  if (!payload || !Array.isArray(payload.entries)) return [];
  const output = [];
  for (const entry of payload.entries) {
    if (entry?.type !== "mapping") continue;
    if (Array.isArray(entry.chunks)) output.push(...entry.chunks.filter(Boolean).map(String));
    else if (Array.isArray(entry.nodes)) {
      for (const pair of entry.nodes) if (Array.isArray(pair) && pair[1]) output.push(String(pair[1]));
    }
  }
  return [...new Set(output)];
}

export function manifestNestedObjectKeys(payload, contentObjects) {
  if (!payload || !Array.isArray(payload.entries)) return [];
  const output = [];
  for (const entry of payload.entries) {
    if (entry?.type !== "mapping" || !Array.isArray(entry.chunks)) continue;
    for (const chunkKey of entry.chunks) {
      const record = lookupRecord(contentObjects, chunkKey);
      if (!record) continue;
      if (Array.isArray(record.references) && record.references.length > 0) {
        output.push(...record.references);
        continue;
      }
      const chunk = record.payload ?? record;
      for (const pair of chunk?.entries ?? []) if (Array.isArray(pair) && pair[1]) output.push(String(pair[1]));
    }
  }
  return [...new Set(output.filter(Boolean))];
}

export async function buildConversationStoragePlan(raw, { batchSize = 128, mappingChunkSize = 256 } = {}) {
  const logicalSizeBytes = byteLengthOf(raw);
  if (!isChunkableConversation(raw)) {
    const objectKey = await contentObjectKey("conversation", raw);
    return {
      mode: "whole-conversation-v1",
      objectKey,
      logicalSizeBytes,
      nodeCount: 0,
      mappingChunkCount: 0,
      records: [{
        key: objectKey,
        kind: "conversation",
        hash: hashFromKey(objectKey),
        sizeBytes: logicalSizeBytes,
        payload: raw,
        createdAt: new Date().toISOString(),
      }],
    };
  }

  const { refs, records: nodeRecords } = await buildNodeRecords(raw.mapping, batchSize);
  const { chunks, records: mappingChunkRecords } = await buildMappingChunkRecords(refs, mappingChunkSize);
  const entries = [];
  for (const [key, value] of Object.entries(raw)) {
    if (key === "mapping") entries.push({ type: "mapping", key, chunks, count: refs.length });
    else entries.push({ type: "value", key, value });
  }
  const manifest = { schema: CONVERSATION_MANIFEST_SCHEMA, entries };
  const objectKey = await contentObjectKey(MANIFEST_KIND, manifest);
  const manifestRecord = {
    key: objectKey,
    kind: MANIFEST_KIND,
    hash: hashFromKey(objectKey),
    sizeBytes: byteLengthOf(manifest),
    references: [...new Set(chunks)],
    payload: manifest,
    createdAt: new Date().toISOString(),
  };
  return {
    mode: "mapping-node-chunks-v2",
    objectKey,
    logicalSizeBytes,
    nodeCount: refs.length,
    mappingChunkCount: chunks.length,
    records: [...nodeRecords, ...mappingChunkRecords, manifestRecord],
  };
}

function restoreLegacyNodeRefs(entry, contentObjects) {
  const mapping = {};
  for (const pair of entry.nodes ?? []) {
    const nodeId = Array.isArray(pair) ? pair[0] : null;
    const objectKey = Array.isArray(pair) ? pair[1] : null;
    if (!nodeId || !objectKey) throw new Error("会话分块清单包含无效节点引用");
    const payload = lookupPayload(contentObjects, objectKey);
    if (payload === undefined) throw new Error(`会话节点内容对象缺失：${objectKey}`);
    mapping[nodeId] = payload;
  }
  return mapping;
}

function restoreChunkedNodeRefs(entry, contentObjects) {
  const mapping = {};
  for (const chunkKey of entry.chunks ?? []) {
    const chunk = lookupPayload(contentObjects, chunkKey);
    if (!chunk || chunk.schema !== CONVERSATION_MAP_CHUNK_SCHEMA || !Array.isArray(chunk.entries)) {
      throw new Error(`会话节点引用块缺失或格式错误：${chunkKey}`);
    }
    for (const pair of chunk.entries) {
      const nodeId = Array.isArray(pair) ? pair[0] : null;
      const objectKey = Array.isArray(pair) ? pair[1] : null;
      if (!nodeId || !objectKey) throw new Error(`会话节点引用块包含无效节点：${chunkKey}`);
      const payload = lookupPayload(contentObjects, objectKey);
      if (payload === undefined) throw new Error(`会话节点内容对象缺失：${objectKey}`);
      mapping[nodeId] = payload;
    }
  }
  return mapping;
}

export function restoreConversationFromManifest(manifest, contentObjects) {
  if (!manifest || !Array.isArray(manifest.entries)) throw new Error("不支持的会话分块清单格式");
  const raw = {};
  for (const entry of manifest.entries) {
    if (!entry?.key) continue;
    if (entry.type === "value") {
      raw[entry.key] = entry.value;
      continue;
    }
    if (entry.type !== "mapping") throw new Error(`会话分块清单包含未知条目：${entry.type || "unknown"}`);
    if (Array.isArray(entry.chunks)) raw[entry.key] = restoreChunkedNodeRefs(entry, contentObjects);
    else if (Array.isArray(entry.nodes)) raw[entry.key] = restoreLegacyNodeRefs(entry, contentObjects);
    else throw new Error("会话分块清单缺少节点引用");
  }
  return raw;
}
