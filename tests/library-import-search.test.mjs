import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { createStoredZip, crc32 } from "../apps/extension/dist/zip.js";
import { readZipEntries } from "../apps/extension/dist/zip-reader.js";
import { inspectImportArchives, importArchivesIntoVault } from "../apps/extension/dist/vault-import.js";
import { createMemoryLibraryStore } from "../apps/extension/dist/library-store.js";
import { tokenizeText } from "../apps/extension/dist/vault-index.js";
import { normalizeChatGPTConversation } from "../dist/packages/normalizer/src/index.js";

const fixture = JSON.parse(await readFile(new URL("../fixtures/synthetic/multi-branch-conversation.json", import.meta.url), "utf8"));
const encoder = new TextEncoder();
const u16 = (value) => Buffer.from([value & 255, (value >>> 8) & 255]);
const u32 = (value) => Buffer.from([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);

function deflatedZip(name, content) {
  const nameBytes = Buffer.from(name);
  const data = Buffer.from(content);
  const compressed = deflateRawSync(data);
  const crc = crc32(data);
  const local = Buffer.concat([u32(0x04034b50),u16(20),u16(0x0800),u16(8),u16(0),u16(0),u32(crc),u32(compressed.length),u32(data.length),u16(nameBytes.length),u16(0),nameBytes,compressed]);
  const central = Buffer.concat([u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(8),u16(0),u16(0),u32(crc),u32(compressed.length),u32(data.length),u16(nameBytes.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(0),nameBytes]);
  const end = Buffer.concat([u32(0x06054b50),u16(0),u16(0),u16(1),u16(1),u32(central.length),u32(local.length),u16(0)]);
  return new Uint8Array(Buffer.concat([local,central,end]));
}

function contextVaultZip(raw = fixture) {
  const canonical = normalizeChatGPTConversation(raw, { adapter: "test" });
  return createStoredZip([
    { name: "manifest.json", data: JSON.stringify({ format: "context-vault-history-backup", version: 3 }) },
    { name: `regular/test/canonical.json`, data: JSON.stringify(canonical) },
    { name: `regular/test/raw.json`, data: JSON.stringify(raw) },
    { name: `regular/test/source-metadata.json`, data: JSON.stringify({ locations: [{ type: "regular", present: true }] }) },
  ], new Date("2026-07-26T00:00:00Z"));
}

test("ZIP reader handles stored and deflated entries with CRC validation", async () => {
  const stored = await readZipEntries(createStoredZip([{ name: "hello.txt", data: "你好 ContextVault" }]));
  assert.equal(new TextDecoder().decode(stored.get("hello.txt")), "你好 ContextVault");
  const deflated = await readZipEntries(deflatedZip("conversations.json", JSON.stringify([fixture])));
  assert.equal(JSON.parse(new TextDecoder().decode(deflated.get("conversations.json")))[0].id, fixture.id);
});


test("ZIP import rejects path traversal and enforces uncompressed size limits", async () => {
  await assert.rejects(() => readZipEntries(createStoredZip([{ name: "../escape.txt", data: "bad" }])), /不安全路径/);
  await assert.rejects(() => readZipEntries(createStoredZip([{ name: "large.txt", data: "1234567890" }]), { maxUncompressedBytes: 5 }), /安全上限/);
});

test("ZIP import rejects corrupted content by CRC", async () => {
  const zip = createStoredZip([{ name: "data.txt", data: "original" }]);
  const corrupted = zip.slice();
  const index = Buffer.from(corrupted).indexOf(Buffer.from("original"));
  assert(index > 0);
  corrupted[index] ^= 0xff;
  await assert.rejects(() => readZipEntries(corrupted), /CRC|大小不匹配/);
});

test("direct official conversations.json files are accepted", async () => {
  const store = createMemoryLibraryStore();
  const report = await importArchivesIntoVault({ files: [{ name: "conversations.json", bytes: encoder.encode(JSON.stringify([fixture])) }], store });
  assert.equal(report.inserted, 1);
});

test("ContextVault ZIP imports canonical evidence and indexes all branches", async () => {
  const store = createMemoryLibraryStore();
  const report = await importArchivesIntoVault({ files: [{ name: "backup.zip", bytes: contextVaultZip() }], store });
  assert.equal(report.inserted, 1);
  const stats = await store.getStats();
  assert.equal(stats.conversations, 1);
  assert.equal(stats.evidence, 1);
  const active = await store.search({ query: "Here is the active answer", role: "assistant" });
  assert.equal(active.results.length, 1);
  assert.equal(active.results[0].message.activePath, true);
  const branch = await store.search({ query: "non-active regenerated", role: "assistant" });
  assert.equal(branch.results.length, 1);
  assert.equal(branch.results[0].message.activePath, false);
});


test("multiple independent ContextVault ZIPs can be imported in one selection", async () => {
  const store = createMemoryLibraryStore();
  const second = structuredClone(fixture);
  second.id = "conv-synthetic-002";
  second.title = "Second backup conversation";
  const report = await importArchivesIntoVault({ files: [
    { name: "backup-one.zip", bytes: contextVaultZip(fixture) },
    { name: "backup-two.zip", bytes: contextVaultZip(second) },
  ], store });
  assert.equal(report.inserted, 2);
  assert.equal((await store.getStats()).conversations, 2);
});

test("official OpenAI export ZIP imports and duplicate import does not rebuild evidence", async () => {
  const store = createMemoryLibraryStore();
  const zip = deflatedZip("conversations.json", JSON.stringify([fixture]));
  const first = await importArchivesIntoVault({ files: [{ name: "openai-export.zip", bytes: zip }], store });
  const second = await importArchivesIntoVault({ files: [{ name: "openai-export.zip", bytes: zip }], store });
  assert.equal(first.inserted, 1);
  assert.equal(second.duplicate, 1);
  assert.equal((await store.getStats()).conversations, 1);
  assert.equal((await store.getStats()).evidence, 1);
});


test("numbered official conversation JSON files are detected for large exports", async () => {
  const store = createMemoryLibraryStore();
  const zip = deflatedZip("conversations-001.json", JSON.stringify([fixture]));
  const report = await importArchivesIntoVault({ files: [{ name: "large-openai-export.zip", bytes: zip }], store });
  assert.equal(report.inserted, 1);
  assert.equal(report.detected.official, 1);
});

test("changed conversation updates derived index while retaining evidence versions", async () => {
  const store = createMemoryLibraryStore();
  await importArchivesIntoVault({ files: [{ name: "backup.zip", bytes: contextVaultZip() }], store });
  const changed = structuredClone(fixture);
  changed.title = "Changed title";
  changed.mapping["assistant-active"].message.content.parts[0] = "Updated searchable answer";
  const report = await importArchivesIntoVault({ files: [{ name: "backup-new.zip", bytes: contextVaultZip(changed) }], store });
  assert.equal(report.updated, 1);
  assert.equal((await store.getStats()).evidence, 2);
  assert.equal((await store.search({ query: "Updated searchable answer" })).results.length, 1);
  assert.equal((await store.search({ query: "Here is the active answer" })).results.length, 0);
});


test("older imports preserve evidence but do not roll the current search index backward", async () => {
  const store = createMemoryLibraryStore();
  const newer = structuredClone(fixture);
  newer.update_time = fixture.update_time + 1000;
  newer.mapping["assistant-active"].message.content.parts[0] = "Newest searchable content";
  await importArchivesIntoVault({ files: [{ name: "newer.zip", bytes: contextVaultZip(newer) }], store });
  const report = await importArchivesIntoVault({ files: [{ name: "older.zip", bytes: contextVaultZip(fixture) }], store });
  assert.equal(report.stale, 1);
  assert.equal((await store.getStats()).evidence, 2);
  assert.equal((await store.search({ query: "Newest searchable content" })).results.length, 1);
  assert.equal((await store.search({ query: "Here is the active answer" })).results.length, 0);
});

test("filters work for source and role", async () => {
  const store = createMemoryLibraryStore();
  await importArchivesIntoVault({ files: [{ name: "official.zip", bytes: deflatedZip("conversations.json", JSON.stringify([fixture])) }], store });
  assert.equal((await store.search({ query: "deterministic", sourceKind: "context-vault" })).results.length, 0);
  assert.equal((await store.search({ query: "deterministic", sourceKind: "openai-official", role: "user" })).results.length, 1);
  assert.equal((await store.search({ query: "deterministic", sourceKind: "openai-official", role: "assistant" })).results.length, 0);
});

test("Chinese tokenizer emits characters, bigrams and trigrams", () => {
  const tokens = tokenizeText("本地资料库全文搜索");
  assert(tokens.includes("本"));
  assert(tokens.includes("本地"));
  assert(tokens.includes("本地资"));
  assert(tokens.includes("全文搜索".slice(0,3)));
});

test("archive inspection rejects unrelated ZIPs", async () => {
  await assert.rejects(() => inspectImportArchives([{ name: "empty.zip", bytes: createStoredZip([{ name: "readme.txt", data: "none" }]) }]), /未找到/);
});

test("Agent export uses the current evidence version and respects Project/source filters", async () => {
  const store = createMemoryLibraryStore();
  const projectRaw = structuredClone(fixture);
  projectRaw.id = "agent-project-conversation";
  projectRaw.title = "Agent Project Conversation";
  const canonical = normalizeChatGPTConversation(projectRaw, { adapter: "test" });
  const { buildVaultIndexBundle } = await import("../apps/extension/dist/vault-index.js");
  const bundle = await buildVaultIndexBundle({
    canonical,
    rawEvidence: projectRaw,
    source: { kind: "context-vault", fileName: "project.zip", fingerprint: "project" },
    sourceMetadata: { locations: [{ type: "project", present: true, projectId: "p-agent", projectTitle: "Agent" }] },
    importedAt: "2026-07-26T00:00:00.000Z",
  });
  await store.upsertBundle(bundle);
  const exported = await store.exportAgentRecords({ projectId: "p-agent", sourceKind: "context-vault" });
  assert.equal(exported.conversations.length, 1);
  assert.equal(exported.messages.length, bundle.messages.length);
  assert.equal(exported.evidence.length, 1);
  assert.equal(exported.evidence[0].key, exported.conversations[0].currentEvidenceKey);
  const empty = await store.exportAgentRecords({ projectId: "missing" });
  assert.equal(empty.conversations.length, 0);
});

test("search and Agent records exclude internal tool and reasoning events while raw evidence remains intact", async () => {
  const { buildVaultIndexBundle, contentPartText } = await import("../apps/extension/dist/vault-index.js");
  assert.equal(contentPartText({ type: "tool_call", text: "private tool payload" }), "");
  assert.equal(contentPartText({ type: "reasoning_summary", text: "private reasoning" }), "");
  assert.equal(contentPartText({ type: "tool_call", text: "private tool payload" }, { includeInternal: true }), "private tool payload");

  const canonical = {
    schemaVersion: "0.1",
    conversationId: "context-filter-test",
    title: "Context filtering",
    source: { provider: "chatgpt", adapter: "test", sourceUrl: null },
    createdAt: null,
    updatedAt: null,
    currentNodeId: "assistant",
    nodes: {
      user: {
        nodeId: "user", parentId: null, childrenIds: ["assistant"], messageId: "m-user", role: "user",
        createdAt: null, updatedAt: null,
        content: [{ type: "text", text: "public user goal", rawPayload: {} }],
        model: null, status: null, metadata: {}, rawPayload: {},
      },
      assistant: {
        nodeId: "assistant", parentId: "user", childrenIds: [], messageId: "m-assistant", role: "assistant",
        createdAt: null, updatedAt: null,
        content: [
          { type: "text", text: "public final answer", rawPayload: {} },
          { type: "tool_call", text: "private tool payload", rawPayload: { secret: true } },
          { type: "tool_result", text: "large raw tool response", rawPayload: { internal: true } },
          { type: "reasoning_summary", text: "private reasoning", rawPayload: {} },
          { type: "unknown", sourceType: "internal", text: "unknown internal event", rawPayload: {} },
        ],
        model: null, status: null, metadata: {}, rawPayload: {},
      },
    },
    edges: [{ from: "user", to: "assistant" }],
    activePath: ["user", "assistant"],
    projectId: "project-context-filter",
    metadata: {},
    rawMetadata: {},
  };
  const rawEvidence = { original: "private tool payload and private reasoning remain here" };
  const bundle = await buildVaultIndexBundle({
    canonical,
    rawEvidence,
    source: { kind: "context-vault", fileName: "filter.zip", fingerprint: "filter" },
    importedAt: "2026-07-27T00:00:00.000Z",
  });
  assert.equal(bundle.messages.length, 2);
  assert.match(bundle.messages[1].text, /public final answer/);
  assert.doesNotMatch(bundle.messages[1].text, /private tool payload|large raw tool response|private reasoning|unknown internal event/);
  assert.match(JSON.stringify(bundle.evidence.rawEvidence), /private tool payload/);

  const store = createMemoryLibraryStore();
  await store.upsertBundle(bundle);
  assert.equal((await store.search({ query: "public final answer" })).results.length, 1);
  assert.equal((await store.search({ query: "private tool payload" })).results.length, 0);
  const agent = await store.exportAgentRecords({ projectId: "project-context-filter" });
  assert.equal(agent.messages.length, 2);
  assert.doesNotMatch(agent.messages.map((message) => message.text).join("\n"), /private tool payload|private reasoning/);
  assert.match(JSON.stringify(agent.evidence[0].rawEvidence), /private tool payload/);
});
