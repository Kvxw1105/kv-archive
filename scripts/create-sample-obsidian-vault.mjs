import { readFile, writeFile } from "node:fs/promises";
import { normalizeChatGPTConversation } from "../dist/packages/normalizer/src/index.js";
import { compileKnowledgeGraph } from "../dist/packages/knowledge-graph/src/index.js";
import { renderObsidianVault } from "../dist/packages/obsidian-exporter/src/index.js";
import { createStoredZip } from "../apps/extension/dist/zip.js";

const output = process.argv[2] || ".tmp/SAMPLE_OBSIDIAN_VAULT.zip";
const root = "fixtures/synthetic/knowledge-graph";
const fixture = JSON.parse(await readFile(`${root}/project-fixture.json`, "utf8"));
const raws = await Promise.all([
  "conversation-1.json",
  "conversation-2.json",
].map(async (name) => JSON.parse(await readFile(`${root}/${name}`, "utf8"))));

const graph = await compileKnowledgeGraph({
  ...fixture,
  conversations: raws.map((raw, index) => ({
    canonical: normalizeChatGPTConversation(raw, { adapter: "obsidian-sample" }),
    evidenceHash: `evidence-conv-00${index + 1}`,
  })),
});
const sampleAsset = graph.nodes.find((node) => node.kind === "asset");
const vault = renderObsidianVault(graph, {
  generatedAt: fixture.generatedAt,
  materializedAssetNodeIds: sampleAsset ? [sampleAsset.id] : [],
});
const sampleAssetBytes = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfGQAAAAASUVORK5CYII=",
  "base64",
));
if (vault.report.status !== "COMPLETE") {
  throw new Error(`Sample Vault validation failed: ${JSON.stringify(vault.report)}`);
}
const rootFolder = "ContextVault-Obsidian-AtlasDemo";
const bytes = createStoredZip(vault.entries.map((entry) => ({
  name: `${rootFolder}/${entry.path}`,
  data: entry.kind === "asset" ? sampleAssetBytes : entry.data,
})), new Date(fixture.generatedAt));
await writeFile(output, bytes);
console.log(JSON.stringify({
  output,
  bytes: bytes.byteLength,
  nodes: graph.nodes.length,
  edges: graph.edges.length,
  files: vault.entries.length,
  graphHash: graph.graphHash,
  status: vault.report.status,
  brokenLinks: vault.report.brokenLinks.length,
  invalidCanvasReferences: vault.report.invalidCanvasReferences.length,
}, null, 2));
