import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { createStoredZip, crc32 } from "../apps/extension/dist/zip.js";
import { readZipEntries } from "../apps/extension/dist/zip-reader.js";
import { inspectImportArchives, importArchivesIntoVault, previewImportArchives, commitImportPlan } from "../apps/extension/dist/vault-import.js";
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

const jsonFile = (name, value) => ({ name, bytes: encoder.encode(JSON.stringify(value)) });
const reportSum = (report) => report.inserted + report.updated + report.duplicate + report.stale + report.failed;

test("read-only plan accounts for rejected records, bad files, and bad shards before an explicit commit", async () => {
  const store = createMemoryLibraryStore();
  const alt = structuredClone(fixture);
  alt.id += "-alt";
  const selection = [
    { name: "broken.zip", bytes: encoder.encode("not a ZIP") },
    { name: "conversations-003.json", bytes: encoder.encode("[broken") },
    { name: "mixed.zip", bytes: createStoredZip([
      { name: "conversations-001.json", data: JSON.stringify([fixture, { id: "missing-graph" }]) },
      { name: "conversations-002.json", data: JSON.stringify([alt]) },
      { name: "conversations-004.json", data: "{broken" },
      { name: "index.html", data: "<html>not imported</html>" },
      { name: "attachment.txt", data: "do not import attachment bytes" },
    ]) },
  ];
  const before = await store.getStats();
  const plan = await previewImportArchives(selection);
  assert.deepEqual(await store.getStats(), before);
  assert.equal(await store.getLatestImportReceipt(), null);
  assert.deepEqual([plan.files, plan.records, plan.ready, plan.rejected, plan.blockedUnits, plan.ignoredEntries], [3, 3, 2, 1, 3, 2]);
  assert.equal(plan.inputFiles[2].issues.find((issue) => issue.unit === "record").recordNumber, 2);
  assert.deepEqual(plan.inputFiles.map((row) => row.ready), [0, 0, 2]);
  const receipt = await commitImportPlan({ plan, store });
  assert.equal(receipt.status, "partial");
  assert.equal(receipt.total, reportSum(receipt) + receipt.rejected);
  assert.equal(receipt.inserted, 2);
  assert.equal(receipt.inputFiles[2].inserted, 2);
  assert.equal(receipt.inputFiles[2].fingerprint, plan.inputFiles[2].fingerprint);
  assert.deepEqual(await store.getLatestImportReceipt(), receipt);
  assert.equal((await store.search({ query: "non-active regenerated" })).results.length, 2);
  const evidence = (await store.getConversationDetail("chatgpt:" + fixture.id)).evidence;
  assert.equal(evidence.canonical.source.captureMode, "official-import");
  assert.equal(evidence.canonical.source.completeness, "unknown");
  await assert.rejects(() => commitImportPlan({ plan, store }), /本批已执行/);
  assert.equal((await store.getStats()).imports, 1);
});

test("a ZIP entry with a failed CRC is dropped without blocking a verified sibling", async () => {
  const digestMarker = "corrupt-this-payload";
  const bytes = createStoredZip([
    { name: "conversations-001.json", data: JSON.stringify([fixture]) },
    { name: "conversations-002.json", data: digestMarker },
    { name: "unrelated-asset.bin", data: "A".repeat(4096) },
  ]);
  bytes[Buffer.from(bytes).indexOf(Buffer.from(digestMarker))] ^= 1;
  const store = createMemoryLibraryStore();
  const plan = await previewImportArchives([{ name: "mixed.zip", bytes }], { maxUncompressedBytes: 2500 });
  assert.deepEqual([plan.ready, plan.blockedUnits, plan.ignoredEntries], [1, 1, 1]);
  assert.match(plan.inputFiles[0].issues[0].reason, /CRC/);
  assert.equal((await commitImportPlan({ plan, store })).inserted, 1);
});

test("a File read error is accounted for independently of a good browser File", async () => {
  const store = createMemoryLibraryStore();
  const plan = await previewImportArchives([
    { name: "conversations-001.json", async arrayBuffer() { throw new Error("unreadable"); } },
    new File([JSON.stringify([fixture])], "conversations-002.json"),
  ]);
  assert.equal(plan.blockedUnits, 1);
  assert.equal(plan.ready, 1);
  assert.equal(plan.inputFiles[0].fingerprint, null);
  assert.match(plan.inputFiles[0].issues[0].reason, /unreadable/);
  assert.equal((await commitImportPlan({ plan, store })).inserted, 1);
});

test("official reimport preserves established Project ID and title on both results and indexed messages", async () => {
  const store = createMemoryLibraryStore();
  const projectId = "project-correct";
  const projectTitle = "现有项目归类";
  await importArchivesIntoVault({ files: [{ name: "backup.zip", bytes: createStoredZip([
    { name: "conv/canonical.json", data: JSON.stringify(normalizeChatGPTConversation(fixture, { adapter: "fixture" })) },
    { name: "conv/raw.json", data: JSON.stringify(fixture) },
    { name: "conv/source-metadata.json", data: JSON.stringify({ locations: [{ type: "project", projectId, projectTitle }] }) },
  ]) }], store });
  const raw = structuredClone(fixture);
  raw.project_id = "different-official-project";
  raw.project_title = "Different Project";
  raw.mapping["assistant-active"].message.content.parts[0] = "New searchable import answer";
  raw.update_time += 60;
  const files = [jsonFile("conversations.json", [raw])];
  const update = await importArchivesIntoVault({ files, store });
  const repeat = await importArchivesIntoVault({ files, store });
  assert.deepEqual([update.updated, repeat.duplicate, update.preservedProject], [1, 1, 1]);
  const hit = (await store.search({ query: "New searchable import answer", projectId })).results[0];
  assert.equal(hit.conversation.projectTitle, projectTitle);
  assert.equal(hit.message.projectId, projectId);
  assert.equal(hit.message.projectTitle, projectTitle);
  assert.equal((await store.search({ query: "New searchable import answer", projectId: raw.project_id })).results.length, 0);
  const detail = await store.getConversationDetail("chatgpt:" + fixture.id);
  assert.equal(detail.evidence.rawEvidence.project_id, raw.project_id);
  assert.equal((await store.getStats()).evidence, 2);
});

test("a write error has a shard/record location and an unstored receipt remains truthful", async () => {
  const alt = structuredClone(fixture);
  alt.id += "-alt";
  const plan = await previewImportArchives([jsonFile("conversations.json", [fixture, alt])]);
  const backing = createMemoryLibraryStore();
  const store = {
    async upsertBundle(bundle) {
      if (bundle.conversation.conversationId === fixture.id) throw new Error("write denied");
      return backing.upsertBundle(bundle);
    },
    async putImport() { throw new Error("receipt store unavailable"); },
  };
  const receipt = await commitImportPlan({ plan, store });
  assert.equal(receipt.status, "partial");
  assert.equal(receipt.receiptStored, false);
  assert.match(receipt.receiptError, /receipt store unavailable/);
  assert.deepEqual(receipt.inputFiles[0].issues[0], { unit: "write", entryPath: "conversations.json", recordNumber: 1, reason: "write denied" });
  assert.equal(receipt.total, reportSum(receipt) + receipt.rejected);
  assert.equal((await backing.getStats()).conversations, 1);
});

test("a failed-only dry run exposes the reason without writing even a receipt", async () => {
  const store = createMemoryLibraryStore();
  const plan = await previewImportArchives([jsonFile("conversations.json", { incompatible: true })]);
  assert.deepEqual([plan.ready, plan.blockedUnits], [0, 1]);
  await assert.rejects(() => commitImportPlan({ plan, store }), /无可导入/);
  assert.equal((await store.getStats()).imports, 0);
});
