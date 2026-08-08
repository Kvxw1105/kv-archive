import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeChatGPTConversation } from "../dist/packages/normalizer/src/index.js";
import {
  assertKnowledgeGraph,
  compileKnowledgeGraph,
  parseKnowledgeEvidenceUri,
  validateKnowledgeGraph,
} from "../dist/packages/knowledge-graph/src/index.js";

const root = "fixtures/synthetic/knowledge-graph";
const projectFixture = JSON.parse(await readFile(`${root}/project-fixture.json`, "utf8"));
const expected = JSON.parse(await readFile(`${root}/expected-graph.json`, "utf8"));
const rawConversations = await Promise.all([
  readFile(`${root}/conversation-1.json`, "utf8"),
  readFile(`${root}/conversation-2.json`, "utf8"),
].map(async (promise) => JSON.parse(await promise)));

function compileInput(overrides = {}) {
  return {
    ...structuredClone(projectFixture),
    conversations: rawConversations.map((raw, index) => ({
      canonical: normalizeChatGPTConversation(raw, { adapter: "knowledge-graph-fixture" }),
      evidenceHash: `evidence-conv-00${index + 1}`,
    })),
    ...overrides,
  };
}

function relationKeys(graph) {
  return graph.edges.map((edge) => `${edge.from}|${edge.relation}|${edge.to}`);
}

test("compiles a deterministic provider-neutral Project graph", async () => {
  const first = await compileKnowledgeGraph(compileInput());
  const second = await compileKnowledgeGraph(compileInput({ generatedAt: "2030-01-01T00:00:00.000Z" }));
  const lightweight = await compileKnowledgeGraph({
    ...compileInput(),
    conversations: compileInput().conversations.map((entry) => ({ ...entry, body: "" })),
  });
  assert.equal(first.graphHash, expected.graphHash);
  assert.equal(second.graphHash, expected.graphHash, "wall-clock export time must not change graph identity");
  assert.equal(lightweight.graphHash, expected.graphHash, "lazy body rendering must not change graph identity when source hashes match");
  assert.deepEqual(first.nodes.map((node) => node.id), expected.nodeIds);
  assert.deepEqual(relationKeys(first), expected.relations);
  assert.equal(first.format, "context-vault-knowledge-graph");
  assert.equal(first.schemaVersion, 1);
});

test("graph compiler keeps a readable active body while canonical evidence preserves internal content", async () => {
  const graph = await compileKnowledgeGraph(compileInput());
  const conversation = graph.nodes.find((node) => node.id === "conversation:conv-atlasdemo-002");
  assert.ok(conversation);
  assert.doesNotMatch(conversation.body, /Unknown content remains represented/);
  const canonicalUnknown = compileInput().conversations[1].canonical.nodes["assistant-2"].content.find((part) => part.type === "unknown");
  assert.equal(canonicalUnknown?.text, "Unknown content remains represented.");
  assert.doesNotMatch(conversation.body, /single fixed scene policy/i, "non-active branch must not be rendered into the active conversation body");
  const decision = graph.nodes.find((node) => node.id === "decision:project-atlasdemo:voice-first");
  assert.deepEqual(decision.evidenceUris, [
    "contextvault://conversation/conv-atlasdemo-001/node/assistant-1?evidence=evidence-conv-001",
  ]);
  const project = graph.nodes.find((node) => node.kind === "project");
  assert.match(project.body, /Phase 0B/);
  assert.match(project.body, /Real host acceptance is pending/);
  const memory = graph.nodes.find((node) => node.id === "memory:project-atlasdemo:approved-project-v2");
  assert.match(memory.body, /evidence-backed execution logs/);
});

test("validates graph invariants and evidence references", async () => {
  const graph = await compileKnowledgeGraph(compileInput());
  const validation = validateKnowledgeGraph(graph);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.metrics, {
    nodes: 11,
    edges: 22,
    duplicateNodeIds: 0,
    duplicateEdgeIds: 0,
    danglingEdges: 0,
    missingEvidenceReferences: 0,
    conversationCount: 2,
  });
  assert.doesNotThrow(() => assertKnowledgeGraph(graph));
});

test("reports duplicate IDs, dangling edges and unresolved evidence instead of hiding them", async () => {
  const graph = await compileKnowledgeGraph(compileInput());
  const broken = structuredClone(graph);
  broken.nodes.push(structuredClone(broken.nodes[0]));
  broken.edges.push({
    id: "edge:broken",
    from: "decision:missing",
    to: "conversation:missing",
    relation: "derived_from",
  });
  const decision = broken.nodes.find((node) => node.kind === "decision");
  decision.evidenceUris.push("contextvault://conversation/not-exported/node/n1?evidence=missing");
  const validation = validateKnowledgeGraph(broken);
  assert.equal(validation.ok, false);
  assert(validation.issues.some((issue) => issue.code === "duplicate_node_id"));
  assert(validation.issues.some((issue) => issue.code === "dangling_edge"));
  assert(validation.issues.some((issue) => issue.code === "missing_evidence_conversation"));
  assert.throws(() => assertKnowledgeGraph(broken), /Knowledge graph validation failed/);
});

test("rejects Project mismatches without mutating canonical evidence", async () => {
  const input = compileInput();
  const before = structuredClone(input.conversations[0].canonical);
  input.conversations[0].canonical.projectId = "another-project";
  await assert.rejects(() => compileKnowledgeGraph(input), /belongs to another-project/);
  assert.deepEqual(before.nodes, compileInput().conversations[0].canonical.nodes);
});

test("KnowledgeGraphIR contains no Obsidian path, wiki-link or Canvas contracts", async () => {
  const graph = await compileKnowledgeGraph(compileInput());
  const serialized = JSON.stringify(graph);
  assert.doesNotMatch(serialized, /\[\[[^\]]+\]\]/);
  assert.doesNotMatch(serialized, /\.canvas|contextvault_managed|wiki[-_ ]?link/i);
  assert.equal(graph.nodes.some((node) => node.preferredPath !== undefined), false);
});

test("evidence URI parser is strict and reversible", () => {
  const uri = "contextvault://conversation/conv%20one/node/node%2F1?evidence=sha256%3Aabc";
  assert.deepEqual(parseKnowledgeEvidenceUri(uri), {
    kind: "conversation",
    uri,
    conversationId: "conv one",
    nodeId: "node/1",
    evidenceHash: "sha256:abc",
  });
  assert.equal(parseKnowledgeEvidenceUri("https://example.com/not-evidence"), null);
});

test("unified content objects and typed relations compile into the Project graph", async () => {
  const input = compileInput({
    contentObjects: [
      {
        format: "kv-archive-content-object", schemaVersion: 1, id: "note-one", kind: "note",
        projectId: "project-atlasdemo", projectTitle: "AtlasDemo", title: "Scene policy note",
        body: "Prefer voice-first scene boundaries.", bodyFormat: "markdown", summary: "",
        tags: ["policy"], status: "active", revision: 1,
        source: { type: "manual", provider: null, sourceUrl: null, rawObjectKey: null },
        attachments: [], evidenceUris: ["contextvault://conversation/conv-atlasdemo-001/node/assistant-1?evidence=evidence-conv-001"],
        createdAt: "2026-07-29T00:00:00.000Z", updatedAt: "2026-07-29T00:00:00.000Z",
        archivedAt: null, trashedAt: null, contentHash: "sha256:note-one", metadata: {},
      },
      {
        format: "kv-archive-content-object", schemaVersion: 1, id: "flash-two", kind: "flash",
        projectId: "project-atlasdemo", projectTitle: "AtlasDemo", title: "Follow-up",
        body: "Validate the policy in the Lab Runner.", bodyFormat: "plain", summary: "",
        tags: [], status: "active", revision: 1,
        source: { type: "manual", provider: null, sourceUrl: null, rawObjectKey: null },
        attachments: [], evidenceUris: [],
        createdAt: "2026-07-29T00:01:00.000Z", updatedAt: "2026-07-29T00:01:00.000Z",
        archivedAt: null, trashedAt: null, contentHash: "sha256:flash-two", metadata: {},
      },
    ],
    contentRelations: [{
      format: "kv-archive-content-relation", schemaVersion: 1, id: "relation-one",
      projectId: "project-atlasdemo", fromId: "flash-two", toId: "note-one",
      relation: "depends_on", evidenceUri: null, createdAt: "2026-07-29T00:02:00.000Z", metadata: {},
    }],
  });
  const graph = await compileKnowledgeGraph(input);
  const note = graph.nodes.find((node) => node.id === "content:project-atlasdemo:note-one");
  const flash = graph.nodes.find((node) => node.id === "content:project-atlasdemo:flash-two");
  assert.equal(note?.properties.content_kind, "note");
  assert.equal(flash?.properties.content_kind, "flash");
  assert(graph.edges.some((edge) => edge.from === flash.id && edge.to === note.id && edge.relation === "depends_on"));
  assert(graph.edges.some((edge) => edge.from === note.id && edge.to === "conversation:conv-atlasdemo-001" && edge.relation === "derived_from"));
  assert.equal(validateKnowledgeGraph(graph).ok, true);
});

test("content evidence must resolve to an exported content node", async () => {
  const graph = await compileKnowledgeGraph(compileInput());
  const decision = graph.nodes.find((node) => node.kind === "decision");
  decision.evidenceUris.push("contextvault://content/missing-note?revision=1&hash=sha256%3Amissing");
  const validation = validateKnowledgeGraph(graph);
  assert.equal(validation.ok, false);
  assert(validation.issues.some((issue) => issue.code === "missing_evidence_content"));
  assert.equal(validation.metrics.missingEvidenceReferences, 1);
});
