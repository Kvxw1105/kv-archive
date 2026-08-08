import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { normalizeChatGPTConversation } from "../dist/packages/normalizer/src/index.js";
import { buildVaultIndexBundle, sha256Hex } from "../apps/extension/dist/vault-index.js";
import { createEmptyProjectState, stableStateStringify } from "../apps/extension/dist/state-governance.js";
import { buildAgentBundle } from "../apps/extension/dist/agent-bundle.js";
import { normalizeContentObject, createContentRelation, buildPromotionDraft } from "../dist/packages/content-contract/src/index.js";
import { createStoredZip } from "../apps/extension/dist/zip.js";
import { openAgentRepository, estimateTokens } from "../apps/agent-bridge/dist/agent/agent-core.js";
import { createMcpHandler } from "../apps/agent-bridge/dist/agent/mcp-server.js";

const fixture = JSON.parse(await readFile(new URL("../fixtures/synthetic/multi-branch-conversation.json", import.meta.url), "utf8"));

async function makeRecords() {
  const first = normalizeChatGPTConversation(fixture, { adapter: "agent-test" });
  const secondRaw = structuredClone(fixture);
  secondRaw.id = "conv-project-002";
  secondRaw.title = "AtlasDemo Agent Handoff";
  secondRaw.update_time += 1000;
  secondRaw.mapping["user-1"].message.content.parts[0] = "We need a resumable project snapshot for AtlasDemo.";
  secondRaw.mapping["assistant-active"].message.content.parts[0] = "The next milestone is a read-only MCP bridge with evidence citations.";
  const second = normalizeChatGPTConversation(secondRaw, { adapter: "agent-test" });
  const one = await buildVaultIndexBundle({ canonical: first, rawEvidence: fixture, source: { kind: "context-vault", fileName: "one.zip", fingerprint: "one" }, sourceMetadata: { locations: [{ type: "regular", present: true }] }, importedAt: "2026-07-26T00:00:00.000Z" });
  const two = await buildVaultIndexBundle({ canonical: second, rawEvidence: secondRaw, source: { kind: "context-vault", fileName: "two.zip", fingerprint: "two" }, sourceMetadata: { locations: [{ type: "project", present: true, projectId: "project-atlasdemo", projectTitle: "AtlasDemo" }] }, importedAt: "2026-07-26T00:00:00.000Z" });
  const projectState = createEmptyProjectState("project-atlasdemo", "AtlasDemo");
  projectState.stateHash = await sha256Hex(stableStateStringify(projectState));
  const contentObject = await normalizeContentObject({ kind:"note",projectId:"project-atlasdemo",projectTitle:"AtlasDemo",title:"Agent note",body:"Editable note: validate semantic scene policies in the Lab Runner.",tags:["agent","policy"] },{id:"agent-note",now:"2026-07-26T01:00:00.000Z"});
  const relatedObject = await normalizeContentObject({ kind:"flash",projectId:"project-atlasdemo",projectTitle:"AtlasDemo",title:"Next check",body:"Run the real Recipe loop." },{id:"agent-flash",now:"2026-07-26T01:01:00.000Z"});
  const contentRelation=createContentRelation({projectId:"project-atlasdemo",fromId:relatedObject.id,toId:contentObject.id,relation:"depends_on"},"2026-07-26T01:02:00.000Z");
  const contentPromotion=buildPromotionDraft(contentObject,"task",{now:"2026-07-26T01:03:00.000Z"});
  const contentOperation={format:"kv-archive-content-operation",schemaVersion:1,id:"content-op:agent-note:1",objectId:contentObject.id,projectId:contentObject.projectId,type:"create",expectedRevision:null,resultingRevision:1,beforeHash:null,afterHash:contentObject.contentHash,actor:"test",createdAt:contentObject.createdAt,details:{kind:"note"}};
  return { conversations: [one.conversation, two.conversation], messages: [...one.messages, ...two.messages], evidence: [one.evidence, two.evidence], states: [projectState], contentObjects:[contentObject,relatedObject], contentRelations:[contentRelation], contentOperations:[contentOperation], contentPromotions:[contentPromotion] };
}

async function withBundle(fn) {
  const directory = await mkdtemp(join(tmpdir(), "context-vault-agent-"));
  try {
    const built = await buildAgentBundle(await makeRecords(), { filters: {} });
    const path = join(directory, built.filename);
    await writeFile(path, built.bytes);
    return await fn({ path, built, directory });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("Agent Bundle contains deterministic read-only data files", async () => {
  const built = await buildAgentBundle(await makeRecords(), { filters: { projectId: "all" } });
  assert.equal(built.manifest.format, "context-vault-agent-bundle");
  assert.equal(built.manifest.version, 3);
  assert.equal(built.manifest.readOnly, true);
  assert.equal(built.manifest.counts.conversations, 2);
  assert(built.entries.includes("data/evidence.jsonl"));
  assert(built.entries.includes("data/project-states.jsonl"));
  assert.equal(built.manifest.counts.projectStates, 1);
  assert.equal(built.manifest.counts.contentObjects, 2);
  assert.equal(built.manifest.counts.contentVersions, 0);
  assert.equal(built.manifest.counts.contentRelations, 1);
  assert(built.entries.includes("data/content-objects.jsonl"));
  assert(built.entries.includes("data/content-relations.jsonl"));
  assert.equal(built.manifest.continuityBenchmarkVersion, 1);
  assert(built.entries.includes("CONTINUITY_BENCHMARK.md"));
  assert(!built.entries.some((name) => name.startsWith("assets/")));
});



test("Agent Bundle v1 remains readable without approved project states", async () => {
  const records = await makeRecords();
  const manifest = {
    format: "context-vault-agent-bundle",
    version: 1,
    bundleId: "legacy-v1-bundle",
    readOnly: true,
    counts: { conversations: records.conversations.length, messages: records.messages.length, evidence: records.evidence.length },
  };
  const jsonl = (rows) => rows.map((row) => `${JSON.stringify(row)}\n`).join("");
  const bytes = createStoredZip([
    { name: "manifest.json", data: `${JSON.stringify(manifest)}\n` },
    { name: "data/conversations.jsonl", data: jsonl(records.conversations) },
    { name: "data/messages.jsonl", data: jsonl(records.messages) },
    { name: "data/evidence.jsonl", data: jsonl(records.evidence) },
  ]);
  const directory = await mkdtemp(join(tmpdir(), "context-vault-agent-v1-"));
  try {
    const path = join(directory, "legacy-v1.zip");
    await writeFile(path, bytes);
    const repository = await openAgentRepository(path);
    assert.equal(repository.manifest.version, 1);
    assert.equal(repository.stats().approvedProjectStates, 0);
    assert.equal(repository.searchMessages({ query: "read-only MCP bridge" }).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("Agent Bundle v2 remains readable without unified content files", async () => {
  const records=await makeRecords();
  const manifest={format:"context-vault-agent-bundle",version:2,bundleId:"legacy-v2-bundle",readOnly:true,counts:{conversations:records.conversations.length,messages:records.messages.length,evidence:records.evidence.length,projectStates:records.states.length}};
  const jsonl=(rows)=>rows.map((row)=>`${JSON.stringify(row)}\n`).join("");
  const bytes=createStoredZip([
    {name:"manifest.json",data:`${JSON.stringify(manifest)}\n`},
    {name:"data/conversations.jsonl",data:jsonl(records.conversations)},
    {name:"data/messages.jsonl",data:jsonl(records.messages)},
    {name:"data/evidence.jsonl",data:jsonl(records.evidence)},
    {name:"data/project-states.jsonl",data:jsonl(records.states)},
  ]);
  const directory=await mkdtemp(join(tmpdir(),"context-vault-agent-v2-"));
  try{const path=join(directory,"legacy-v2.zip");await writeFile(path,bytes);const repository=await openAgentRepository(path);assert.equal(repository.manifest.version,2);assert.equal(repository.stats().contentObjects,0);assert.equal(repository.listProjects().length>0,true);}finally{await rm(directory,{recursive:true,force:true});}
});

test("Agent repository searches messages and returns provenance", async () => withBundle(async ({ path }) => {
  const repository = await openAgentRepository(path);
  const results = repository.searchMessages({ query: "read-only MCP bridge", limit: 10 });
  assert.equal(results.length, 1);
  assert.equal(results[0].conversation.projectTitle, "AtlasDemo");
  assert.match(results[0].provenance.uri, /^contextvault:\/\/conversation\//);
  assert.equal(results[0].message.activePath, true);
}));

test("Agent repository searches and reads unified content with stable provenance", async () => withBundle(async ({ path }) => {
  const repository=await openAgentRepository(path);
  const results=repository.searchContent({query:"semantic scene policies",projectId:"project-atlasdemo"});
  assert.equal(results.length,1);
  assert.equal(results[0].object.id,"agent-note");
  assert.match(results[0].provenance.uri,/^contextvault:\/\/content\//);
  const detail=repository.readContent("agent-note");
  assert.match(detail.object.body,/Lab Runner/);
  assert.equal(detail.relations.length,1);
  assert.equal(detail.operations.length,1);
  assert.equal(detail.promotions.length,1);
  assert.equal(repository.hasProvenanceUri(detail.provenance.uri),true);
}));

test("Context Pack can cite unified notes alongside conversation evidence", async () => withBundle(async ({path})=>{
  const repository=await openAgentRepository(path);
  const pack=repository.buildContextPack({query:"semantic scene policies",projectId:"project-atlasdemo",budgetTokens:2048});
  assert.match(pack.markdown,/Type: note/);
  assert.match(pack.markdown,/contextvault:\/\/content\/agent-note/);
  assert(pack.sources.some((source)=>source.objectId==="agent-note"));
}));

test("Agent repository reads active conversation and bounded source evidence", async () => withBundle(async ({ path }) => {
  const repository = await openAgentRepository(path);
  const detail = repository.readConversation("conv-project-002", { activePathOnly: true });
  assert(detail.messages.length > 0);
  assert(detail.messages.every((message) => message.activePath));
  const evidence = repository.sourceEvidence("conv-project-002", { mode: "raw", maxChars: 1000 });
  assert.equal(evidence.mode, "raw");
  assert.equal(typeof evidence.truncated, "boolean");
}));

test("Context Packs are deterministic, cited and stay within supported budgets", async () => withBundle(async ({ path }) => {
  const repository = await openAgentRepository(path);
  for (const budgetTokens of [2048, 8192, 32768]) {
    const options = { query: "read-only MCP bridge", budgetTokens };
    const first = repository.buildContextPack(options);
    const second = repository.buildContextPack(options);
    assert.equal(first.markdown, second.markdown);
    assert(first.estimatedTokens <= budgetTokens, `${first.estimatedTokens} > ${budgetTokens}`);
    assert.equal(first.estimatedTokens, estimateTokens(first.markdown));
    assert.match(first.markdown, /Evidence: contextvault:\/\//);
    assert(first.sources.every((source) => source.evidenceHash));
  }
}));

test("Project snapshots expose inventory without mutating evidence", async () => withBundle(async ({ path }) => {
  const repository = await openAgentRepository(path);
  const snapshot = repository.projectSnapshot("AtlasDemo");
  assert.equal(snapshot.project.id, "project-atlasdemo");
  assert.equal(snapshot.conversationCount, 1);
  assert.match(snapshot.conversations[0].title, /AtlasDemo/);
  assert.equal(repository.stats().readOnly, true);
}));

test("MCP exposes unified read-only evidence tools and one non-destructive proposal outbox tool", async () => withBundle(async ({ path, directory }) => {
  const proposalDir = join(directory, "proposals");
  const handle = await createMcpHandler(path, { proposalDir });
  const initialized = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "test", version: "1" }, capabilities: {} } });
  assert.equal(initialized.result.protocolVersion, "2025-06-18");
  assert.equal(initialized.result.serverInfo.version, "0.16.11");
  const listed = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const names = listed.result.tools.map((tool) => tool.name);
  assert.equal(names.length, 12);
  assert(names.includes("run_memory_gate"));
  assert(names.includes("build_context_pack"));
  assert(names.includes("list_content_objects"));
  assert(names.includes("search_content"));
  assert(names.includes("read_content_object"));
  assert(names.includes("create_state_proposal"));
  const evidenceTools = listed.result.tools.filter((tool) => tool.name !== "create_state_proposal");
  assert(evidenceTools.every((tool) => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false));
  const proposalTool = listed.result.tools.find((tool) => tool.name === "create_state_proposal");
  assert.equal(proposalTool.annotations.readOnlyHint, false);
  assert.equal(proposalTool.annotations.destructiveHint, false);
  const called = await handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_messages", arguments: { query: "AtlasDemo" } } });
  assert.equal(called.result.isError, undefined);
  const search = JSON.parse(called.result.content[0].text);
  const uri = search[0].provenance.uri;
  const contentCalled=await handle({jsonrpc:"2.0",id:31,method:"tools/call",params:{name:"search_content",arguments:{query:"semantic scene policies",projectId:"project-atlasdemo"}}});
  const contentSearch=JSON.parse(contentCalled.result.content[0].text);
  assert.equal(contentSearch[0].object.id,"agent-note");
  const proposed = await handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "create_state_proposal", arguments: {
    project: "AtlasDemo", kind: "project_status", title: "Mark MCP bridge complete", rationale: "Evidence shows the bridge milestone is complete.", expectedImpact: "Update approved project phase after review.", riskLevel: "low", evidenceUris: [uri], change: { summary: "Read-only MCP bridge completed", phase: "Batch 5 complete", health: "healthy", progressPercent: 80, blockers: [], nextActions: ["Begin reviewed state workflow"] }
  } } });
  assert.equal(proposed.result.isError, undefined);
  const proposalResult = JSON.parse(proposed.result.content[0].text);
  assert.equal(proposalResult.approvalRequired, true);
  assert.equal(proposalResult.approvedStateMutated, false);
  const proposal = JSON.parse(await readFile(proposalResult.proposalPath, "utf8"));
  assert.equal(proposal.baseVersion, 0);
  assert.equal(proposal.kind, "project_status");
  const rejected = await handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "approve_state_proposal", arguments: {} } });
  assert.equal(rejected.error.code, -32601);
}));

test("MCP stdio server uses newline-delimited JSON-RPC and keeps logs on stderr", async () => withBundle(async ({ path }) => {
  const child = spawn(process.execPath, ["apps/agent-bridge/dist/agent/index.js", "serve", "--bundle", path], { cwd: new URL("..", import.meta.url), stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");
  await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error(`stdio timeout: ${stdout} ${stderr}`)), 4000); const poll = setInterval(() => { if (stdout.trim().split(/\n/).length >= 2) { clearTimeout(timeout); clearInterval(poll); resolve(); } }, 20); });
  child.kill("SIGTERM");
  const lines = stdout.trim().split(/\n/).map(JSON.parse);
  assert.equal(lines[0].id, 1);
  assert.equal(lines[1].id, 2);
  assert(!stdout.includes("server loaded"));
  assert.match(stderr, /controlled-proposal server loaded/);
}));

test("Agent CLI writes a bounded Context Pack", async () => withBundle(async ({ path, directory }) => {
  const output = join(directory, "pack.md");
  const result = spawnSync(process.execPath, ["apps/agent-bridge/dist/agent/index.js", "pack", "--bundle", path, "--query", "MCP evidence", "--budget", "2048", "--output", output], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const markdown = await readFile(output, "utf8");
  assert.match(markdown, /ContextVault Context Pack/);
  assert(estimateTokens(markdown) <= 2048);
}));

test("Agent Bundle export applies a preflight size cap", async () => {
  await assert.rejects(() => buildAgentBundle(makeRecords(), { maxBytes: 100 }), /超过 512 MB|缩小筛选范围/);
});

test("Agent Bundle loader rejects corrupted ZIP evidence", async () => {
  const built = await buildAgentBundle(await makeRecords());
  const corrupted = built.bytes.slice();
  const marker = new TextEncoder().encode('context-vault-agent-bundle');
  let index = -1;
  outer: for (let i = 0; i <= corrupted.length - marker.length; i += 1) {
    for (let j = 0; j < marker.length; j += 1) if (corrupted[i + j] !== marker[j]) continue outer;
    index = i; break;
  }
  assert(index > 0);
  corrupted[index] ^= 0xff;
  const directory = await mkdtemp(join(tmpdir(), "context-vault-agent-corrupt-"));
  try {
    const path = join(directory, "corrupt.zip");
    await writeFile(path, corrupted);
    await assert.rejects(() => openAgentRepository(path), /CRC mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Agent CLI propose writes only a reviewable proposal and no raw evidence payload", async () => withBundle(async ({ path, directory }) => {
  const repository = await openAgentRepository(path);
  const result = repository.searchMessages({ query: "read-only MCP bridge", limit: 1 });
  const evidenceUri = result[0].provenance.uri;
  const input = join(directory, "proposal-draft.json");
  const proposalDir = join(directory, "proposal-outbox");
  await writeFile(input, JSON.stringify({
    project: "AtlasDemo",
    kind: "project_status",
    title: "Advance reviewed state workflow",
    rationale: "The cited evidence confirms the read-only bridge milestone.",
    expectedImpact: "Update only the approved phase after human review.",
    riskLevel: "low",
    evidenceUris: [evidenceUri],
    change: { phase: "Batch 6 review" },
    agentName: "packaged-cli-test",
  }));
  const cli = spawnSync(process.execPath, ["apps/agent-bridge/dist/agent/index.js", "propose", "--bundle", path, "--input", input, "--proposal-dir", proposalDir], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  const summary = JSON.parse(cli.stdout);
  assert.equal(summary.approvalRequired, true);
  const proposal = JSON.parse(await readFile(summary.proposalPath, "utf8"));
  assert.equal(proposal.change.phase, "Batch 6 review");
  assert.equal(proposal.baseVersion, 0);
  const text = JSON.stringify(proposal);
  assert(!text.includes("The next milestone is a read-only MCP bridge with evidence citations."));
  assert(!text.match(/authorization|bearer|cookie|accessToken/i));
  assert.deepEqual(Object.keys(proposal).sort(), ["agent", "baseStateHash", "baseVersion", "change", "createdAt", "evidenceUris", "expectedImpact", "format", "id", "kind", "projectId", "projectTitle", "rationale", "riskLevel", "schemaVersion", "title"].sort());
}));
