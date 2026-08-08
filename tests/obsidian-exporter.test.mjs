import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeChatGPTConversation } from "../dist/packages/normalizer/src/index.js";
import { compileKnowledgeGraph } from "../dist/packages/knowledge-graph/src/index.js";
import {
  allocateObsidianPaths,
  renderFlatYaml,
  renderObsidianVault,
  sanitizeObsidianFilename,
  validateObsidianVaultEntries,
} from "../dist/packages/obsidian-exporter/src/index.js";

const root = "fixtures/synthetic/knowledge-graph";
const projectFixture = JSON.parse(await readFile(`${root}/project-fixture.json`, "utf8"));
const rawConversations = await Promise.all([
  readFile(`${root}/conversation-1.json`, "utf8"),
  readFile(`${root}/conversation-2.json`, "utf8"),
].map(async (promise) => JSON.parse(await promise)));

async function graphFixture(overrides = {}) {
  return compileKnowledgeGraph({
    ...structuredClone(projectFixture),
    conversations: rawConversations.map((raw, index) => ({
      canonical: normalizeChatGPTConversation(raw, { adapter: "knowledge-graph-fixture" }),
      evidenceHash: `evidence-conv-00${index + 1}`,
    })),
    ...overrides,
  });
}

test("renders a plugin-free Obsidian Vault plan with zero broken links", async () => {
  const graph = await graphFixture();
  const plan = renderObsidianVault(graph);
  assert.equal(plan.report.status, "COMPLETE");
  assert.equal(plan.report.brokenLinks.length, 0);
  assert.equal(plan.report.invalidCanvasReferences.length, 0);
  assert.equal(plan.report.duplicatePaths.length, 0);
  assert.equal(plan.report.orphanNodeIds.length, 0);
  const paths = new Set(plan.entries.map((entry) => entry.path));
  for (const required of [
    "00 Home/KV Archive Home.md",
    "00 Home/START_HERE.md",
    "00 Home/IMPORT_OPTIONS.md",
    "00 Home/AGENT_PROMPT.md",
    "00 Home/Project MOC.md",
    "00 Home/Export Guide.md",
    "80 Canvas/Project Map.canvas",
    "99 System/AGENT_HANDOFF.md",
    "99 System/kv-import-manifest.json",
    "99 System/kv-import-receipt.template.json",
    "99 System/contextvault-manifest.json",
    "99 System/path-map.json",
    "99 System/export-report.json",
  ]) assert(paths.has(required), `missing ${required}`);
  assert.equal(plan.manifest.graphHash, graph.graphHash);
  assert.equal(plan.manifest.pathMap["project:project-atlasdemo"].path.startsWith("10 Projects/"), true);
  const manifestEntry = plan.entries.find((entry) => entry.path === "99 System/contextvault-manifest.json");
  assert.ok(manifestEntry);
  const serializedManifest = JSON.parse(manifestEntry.data);
  assert(serializedManifest.files.some((file) => file.path === "99 System/contextvault-manifest.json"));
});

test("Markdown contains flat YAML, managed metadata, wiki links and evidence URIs", async () => {
  const graph = await graphFixture();
  const plan = renderObsidianVault(graph);
  const decisionPath = plan.pathMap["decision:project-atlasdemo:voice-first"].path;
  const entry = plan.entries.find((item) => item.path === decisionPath);
  assert.ok(entry);
  assert.equal(typeof entry.data, "string");
  assert.match(entry.data, /^---\n/);
  assert.match(entry.data, /contextvault_managed: true/);
  assert.match(entry.data, /contextvault_type: "decision"/);
  assert.match(entry.data, /\[\[10 Projects\//);
  assert.match(entry.data, /\[\[20 Conversations\//);
  assert.match(entry.data, /contextvault:\/\/conversation\/conv-atlasdemo-001/);
  assert.doesNotMatch(entry.data, /^\s{4,}\S/m, "frontmatter must remain flat rather than nested");
});

test("stable path registry survives title changes and reports removed paths", async () => {
  const firstGraph = await graphFixture();
  const first = allocateObsidianPaths(firstGraph, {}, "2026-07-26T09:00:00.000Z");
  const changed = structuredClone(firstGraph);
  const conversation = changed.nodes.find((node) => node.id === "conversation:conv-atlasdemo-001");
  conversation.title = "A completely renamed conversation";
  const second = allocateObsidianPaths(changed, first.pathMap, "2026-07-27T09:00:00.000Z");
  assert.equal(second.pathMap[conversation.id].path, first.pathMap[conversation.id].path);
  assert.equal(second.reusedPaths, Object.keys(first.pathMap).length);
  const removedGraph = structuredClone(changed);
  removedGraph.nodes = removedGraph.nodes.filter((node) => node.id !== conversation.id);
  const third = allocateObsidianPaths(removedGraph, second.pathMap, "2026-07-28T09:00:00.000Z");
  assert.deepEqual(third.removedPaths, [first.pathMap[conversation.id].path]);
});

test("portable filenames handle Windows reserved names and forbidden characters", () => {
  assert.equal(sanitizeObsidianFilename("CON"), "_CON");
  assert.equal(sanitizeObsidianFilename("A<B>:C/ D\\E|F?G*"), "A B C D E F G");
  assert.equal(sanitizeObsidianFilename("trailing.   "), "trailing");
  assert.equal(sanitizeObsidianFilename(""), "Untitled");
});

test("Canvas uses unique IDs and references exported Markdown files", async () => {
  const graph = await graphFixture();
  const plan = renderObsidianVault(graph, { canvasNodeLimit: 8 });
  assert(plan.canvas.nodes.length <= 8);
  assert.equal(new Set(plan.canvas.nodes.map((node) => node.id)).size, plan.canvas.nodes.length);
  assert.equal(new Set(plan.canvas.edges.map((edge) => edge.id)).size, plan.canvas.edges.length);
  const entryPaths = new Set(plan.entries.map((entry) => entry.path));
  for (const node of plan.canvas.nodes) {
    if (node.type === "file") assert(entryPaths.has(node.file), `invalid Canvas file ${node.file}`);
  }
  const canvasNodeIds = new Set(plan.canvas.nodes.map((node) => node.id));
  for (const edge of plan.canvas.edges) {
    assert(canvasNodeIds.has(edge.fromNode));
    assert(canvasNodeIds.has(edge.toNode));
  }
});

test("validator exposes broken wiki links and Canvas references", async () => {
  const graph = await graphFixture();
  const plan = renderObsidianVault(graph);
  const brokenEntries = structuredClone(plan.entries);
  brokenEntries.push({ path: "Broken.md", data: "[[Missing/Note]]", kind: "markdown" });
  const brokenCanvas = structuredClone(plan.canvas);
  brokenCanvas.nodes.push({ id: "missing-file", type: "file", file: "Missing.md", x: 0, y: 0, width: 100, height: 100 });
  const validation = validateObsidianVaultEntries(brokenEntries, brokenCanvas);
  assert(validation.brokenLinks.includes("Broken.md -> Missing/Note"));
  assert(validation.invalidCanvasReferences.includes("missing-file -> Missing.md"));
});

test("flat YAML quotes ambiguous strings and emits arrays without nested objects", () => {
  const yaml = renderFlatYaml({
    title: "yes",
    count: 2,
    enabled: true,
    missing: null,
    tags: ["contextvault/project", "中文"],
    aliases: [],
  });
  assert.match(yaml, /title: "yes"/);
  assert.match(yaml, /count: 2/);
  assert.match(yaml, /enabled: true/);
  assert.match(yaml, /missing: null/);
  assert.match(yaml, /tags:\n  - "contextvault\/project"\n  - "中文"/);
  assert.match(yaml, /aliases: \[\]/);
});


test("Agent-ready Obsidian bundle exposes safe import instructions and machine-readable manifest", async () => {
  const graph = await graphFixture();
  const plan = renderObsidianVault(graph, { generatedAt: "2026-07-27T12:00:00.000Z" });
  const byPath = new Map(plan.entries.map((entry) => [entry.path, entry]));
  const start = byPath.get("00 Home/START_HERE.md");
  const prompt = byPath.get("00 Home/AGENT_PROMPT.md");
  const handoff = byPath.get("99 System/AGENT_HANDOFF.md");
  const importManifest = JSON.parse(byPath.get("99 System/kv-import-manifest.json").data);
  const receipt = JSON.parse(byPath.get("99 System/kv-import-receipt.template.json").data);

  assert.match(start.data, /三种使用方式/);
  assert.match(start.data, /已有自己的 Obsidian 库/);
  assert.match(prompt.data, /先不要修改任何现有文件/);
  assert.match(prompt.data, /不得覆盖 \.obsidian/);
  assert.match(handoff.data, /Preflight is read-only/);
  assert.equal(importManifest.format, "kv-archive-obsidian-import-bundle");
  assert.equal(importManifest.generatedAt, "2026-07-27T12:00:00.000Z");
  assert.equal(importManifest.entryFile, "00 Home/START_HERE.md");
  assert.equal(importManifest.containsObsidianConfig, false);
  assert.equal(importManifest.safety.preflightReadOnly, true);
  assert.equal(importManifest.safety.overwriteExistingFiles, false);
  assert.equal(importManifest.expectedFiles, plan.entries.length);
  assert.match(importManifest.recommendedRoot, /^KV Archive\//);
  assert.equal(receipt.status, "PLANNED");
  assert.equal(receipt.rollback.deleteOnlyCreatedFiles, true);
});

test("disabling the optional export guide does not leave a broken home link", async () => {
  const graph = await graphFixture();
  const plan = renderObsidianVault(graph, { includeGuide: false });
  assert.equal(plan.report.brokenLinks.length, 0);
  const home = plan.entries.find((entry) => entry.path === "00 Home/KV Archive Home.md");
  assert.ok(home);
  assert.doesNotMatch(home.data, /Export Guide/);
});
