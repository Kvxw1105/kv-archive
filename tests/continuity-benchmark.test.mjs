import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { normalizeChatGPTConversation } from "../dist/packages/normalizer/src/index.js";
import { buildVaultIndexBundle, sha256Hex } from "../apps/extension/dist/vault-index.js";
import { createEmptyProjectState, stableStateStringify } from "../apps/extension/dist/state-governance.js";
import { buildAgentBundle } from "../apps/extension/dist/agent-bundle.js";
import { openAgentRepository } from "../apps/agent-bridge/dist/agent/agent-core.js";
import { createContinuityBenchmark, evaluateContinuityResponse } from "../apps/agent-bridge/dist/agent/continuity-benchmark.js";

const fixture = JSON.parse(await readFile(new URL("../fixtures/synthetic/multi-branch-conversation.json", import.meta.url), "utf8"));

async function makeRecords() {
  const raw = structuredClone(fixture);
  raw.id = "conv-continuity-001";
  raw.title = "AtlasDemo continuity milestone";
  raw.mapping["user-1"].message.content.parts[0] = "Protect current evidence and prepare the next verified handoff.";
  raw.mapping["assistant-active"].message.content.parts[0] = "The current milestone is Continuity Benchmark before Memory Gate.";
  const canonical = normalizeChatGPTConversation(raw, { adapter: "continuity-test" });
  const indexed = await buildVaultIndexBundle({
    canonical,
    rawEvidence: raw,
    source: { kind: "context-vault", fileName: "continuity.zip", fingerprint: "continuity" },
    sourceMetadata: { locations: [{ type: "project", present: true, projectId: "project-atlasdemo", projectTitle: "AtlasDemo" }] },
    importedAt: "2026-07-27T00:00:00.000Z",
  });
  const state = createEmptyProjectState("project-atlasdemo", "AtlasDemo");
  state.stateVersion = 3;
  state.updatedAt = "2026-07-27T00:00:00.000Z";
  state.status = {
    summary: "The archive and Agent Bridge are locally verified; real browser acceptance remains pending.",
    phase: "Continuity Benchmark",
    health: "at_risk",
    progressPercent: 72,
    blockers: ["Real Chrome account acceptance is pending"],
    nextActions: ["Run the Continuity Benchmark before Memory Gate"],
  };
  state.decisions = [{
    id: "decision-evidence-readonly",
    title: "Keep evidence access read-only",
    summary: "Agents may propose state changes but cannot mutate approved state.",
    status: "active",
    consequences: ["All changes remain reviewable"],
    evidenceUris: [],
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    supersededAt: null,
    supersededByProposalId: null,
  }];
  state.tasks = [{
    id: "task-continuity-benchmark",
    title: "Establish the project handoff benchmark",
    status: "in_progress",
    priority: "high",
    owner: null,
    dueDate: null,
    notes: "Score identity, state, decisions, tasks, next actions and evidence.",
    evidenceUris: [],
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    supersededAt: null,
    supersededByProposalId: null,
  }];
  state.stateHash = await sha256Hex(stableStateStringify(state));
  return { conversations: [indexed.conversation], messages: indexed.messages, evidence: [indexed.evidence], states: [state] };
}

async function withBundle(fn) {
  const directory = await mkdtemp(join(tmpdir(), "kv-archive-continuity-"));
  try {
    const built = await buildAgentBundle(await makeRecords(), { filters: { projectId: "project-atlasdemo" } });
    const path = join(directory, built.filename);
    await writeFile(path, built.bytes);
    const repository = await openAgentRepository(path);
    return await fn({ directory, path, repository });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function perfectResponse(answerKey) {
  return {
    format: "kv-archive-continuity-response",
    version: 1,
    project: structuredClone(answerKey.expected.project),
    status: structuredClone(answerKey.expected.status),
    decisions: structuredClone(answerKey.expected.decisions),
    tasks: structuredClone(answerKey.expected.tasks),
    blockers: [...answerKey.expected.blockers],
    nextActions: [...answerKey.expected.nextActions],
    evidenceUris: [...answerKey.expected.evidenceUris],
    uncertainties: [],
  };
}

test("Continuity Benchmark creates a deterministic challenge without leaking the answer key", async () => withBundle(async ({ repository }) => {
  const options = { project: "AtlasDemo", generatedAt: "2026-07-27T12:00:00.000Z" };
  const first = createContinuityBenchmark(repository, options);
  const second = createContinuityBenchmark(repository, options);
  assert.equal(first.challenge.benchmarkId, second.challenge.benchmarkId);
  assert.deepEqual(first.challenge, second.challenge);
  assert.equal(first.challenge.project.id, "project-atlasdemo");
  assert.equal(first.answerKey.expected.status.phase, "Continuity Benchmark");
  assert.equal(first.answerKey.expected.decisions[0].id, "decision-evidence-readonly");
  assert.equal(first.answerKey.expected.tasks[0].id, "task-continuity-benchmark");
  assert(first.answerKey.expected.evidenceUris.length > 0);
  const publicText = JSON.stringify(first.challenge);
  assert(!publicText.includes("Keep evidence access read-only"));
  assert(!publicText.includes("Real Chrome account acceptance is pending"));
  assert.equal(first.responseTemplate.project.id, null);
}));

test("Continuity Benchmark gives a perfect evidence-backed handoff 100 and PASS", async () => withBundle(async ({ repository }) => {
  const benchmark = createContinuityBenchmark(repository, { project: "project-atlasdemo", generatedAt: "2026-07-27T12:00:00.000Z" });
  const result = evaluateContinuityResponse(repository, benchmark.answerKey, perfectResponse(benchmark.answerKey));
  assert.equal(result.report.score, 100);
  assert.equal(result.report.verdict, "PASS");
  assert.equal(result.report.verified, true);
  assert.equal(result.report.criticalIssues.length, 0);
  assert.match(result.markdown, /Verified handoff: \*\*yes\*\*/);
}));

test("Continuity Benchmark fails wrong identity, unsupported records and invalid evidence", async () => withBundle(async ({ repository }) => {
  const benchmark = createContinuityBenchmark(repository, { project: "AtlasDemo" });
  const response = perfectResponse(benchmark.answerKey);
  response.project.id = "wrong-project";
  response.decisions.push({ id: "invented-decision", title: "Invented", status: "active" });
  response.tasks.push({ id: "invented-task", title: "Invented", status: "todo", priority: "high" });
  response.evidenceUris.push("contextvault://conversation/fake/node/fake?evidence=fake");
  const result = evaluateContinuityResponse(repository, benchmark.answerKey, response);
  assert.equal(result.report.verdict, "FAIL");
  assert.equal(result.report.verified, false);
  assert(result.report.criticalIssues.some((item) => item.includes("Project ID")));
  assert(result.report.criticalIssues.some((item) => item.includes("Unsupported decision")));
  assert(result.report.criticalIssues.some((item) => item.includes("Unsupported task")));
  assert(result.report.criticalIssues.some((item) => item.includes("Invalid evidence")));
}));

test("Agent CLI creates and scores a Continuity Benchmark run", async () => withBundle(async ({ directory, path }) => {
  const runDir = join(directory, "benchmark-run");
  const created = spawnSync(process.execPath, ["apps/agent-bridge/dist/agent/index.js", "benchmark-create", "--bundle", path, "--project", "AtlasDemo", "--generated-at", "2026-07-27T12:00:00.000Z", "--output", runDir], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  const answerKey = JSON.parse(await readFile(join(runDir, "benchmark-answer-key.json"), "utf8"));
  const responsePath = join(directory, "agent-response.json");
  await writeFile(responsePath, `${JSON.stringify(perfectResponse(answerKey), null, 2)}\n`);
  const reportDir = join(directory, "benchmark-report");
  const scored = spawnSync(process.execPath, ["apps/agent-bridge/dist/agent/index.js", "benchmark-score", "--bundle", path, "--benchmark", join(runDir, "benchmark-answer-key.json"), "--response", responsePath, "--output", reportDir], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.equal(scored.status, 0, scored.stderr);
  const report = JSON.parse(await readFile(join(reportDir, "continuity-report.json"), "utf8"));
  assert.equal(report.verdict, "PASS");
  assert.equal(report.score, 100);
  assert.match(await readFile(join(reportDir, "continuity-report.md"), "utf8"), /Continuity Benchmark Report/);
}));

import { compareMemoryGateBenchmarkResponses, createMemoryGateBenchmarkExperiment } from "../apps/agent-bridge/dist/agent/memory-gate-benchmark.js";

test("Memory Gate paired benchmark creates equal-budget off/on Context Packs", async () => withBundle(async ({ repository }) => {
  const experiment = createMemoryGateBenchmarkExperiment(repository, { project:"AtlasDemo", query:"Continue the benchmark milestone", budgetTokens:8192, gatePolicy:"balanced", generatedAt:"2026-07-27T12:00:00.000Z" });
  assert.equal(experiment.budgetTokens, 8192);
  assert.match(experiment.packs.off.markdown, /ContextVault Context Pack/);
  assert.match(experiment.packs.on.markdown, /Memory Gate: balanced/);
  assert.ok(experiment.packs.on.memoryGate);
  assert.equal(experiment.benchmark.challenge.benchmarkId, experiment.benchmark.answerKey.benchmarkId);
}));

test("Memory Gate paired benchmark reports score delta and failure taxonomy without claiming universal improvement", async () => withBundle(async ({ repository }) => {
  const experiment = createMemoryGateBenchmarkExperiment(repository, { project:"AtlasDemo", generatedAt:"2026-07-27T12:00:00.000Z" });
  const on = perfectResponse(experiment.benchmark.answerKey);
  const off = perfectResponse(experiment.benchmark.answerKey);
  off.project.id = "wrong-project";
  off.evidenceUris = [];
  const result = compareMemoryGateBenchmarkResponses(repository, experiment.benchmark.answerKey, off, on, { experimentId:experiment.experimentId, generatedAt:"2026-07-27T13:00:00.000Z" });
  assert.equal(result.report.conclusion, "IMPROVED");
  assert.ok(result.report.scoreDelta > 0);
  assert.ok(result.report.off.taxonomy.includes("WRONG_PROJECT_ID"));
  assert.equal(result.report.on.score, 100);
  assert.match(result.markdown, /does not claim a universal model-quality improvement/i);
}));

test("Agent CLI creates and scores a paired Memory Gate benchmark experiment", async () => withBundle(async ({ directory, path }) => {
  const experimentDir = join(directory, "gate-experiment");
  const created = spawnSync(process.execPath, ["apps/agent-bridge/dist/agent/index.js", "benchmark-gate-create", "--bundle", path, "--project", "AtlasDemo", "--query", "Continue the benchmark milestone", "--generated-at", "2026-07-27T12:00:00.000Z", "--output", experimentDir], { cwd:new URL("..", import.meta.url), encoding:"utf8" });
  assert.equal(created.status, 0, created.stderr);
  const answerKey = JSON.parse(await readFile(join(experimentDir, "benchmark-answer-key.json"), "utf8"));
  const off = perfectResponse(answerKey); off.tasks=[]; off.evidenceUris=[];
  const on = perfectResponse(answerKey);
  await writeFile(join(experimentDir,"response-gate-off.json"),`${JSON.stringify(off,null,2)}\n`);
  await writeFile(join(experimentDir,"response-gate-on.json"),`${JSON.stringify(on,null,2)}\n`);
  const output=join(directory,"gate-comparison");
  const scored=spawnSync(process.execPath,["apps/agent-bridge/dist/agent/index.js","benchmark-gate-score","--bundle",path,"--benchmark",join(experimentDir,"benchmark-answer-key.json"),"--response-off",join(experimentDir,"response-gate-off.json"),"--response-on",join(experimentDir,"response-gate-on.json"),"--output",output],{cwd:new URL("..",import.meta.url),encoding:"utf8"});
  assert.equal(scored.status,0,scored.stderr);
  const comparison=JSON.parse(await readFile(join(output,"memory-gate-benchmark-comparison.json"),"utf8"));
  assert.ok(comparison.scoreDelta>0);
  assert.equal(comparison.conclusion,"IMPROVED");
  assert.match(await readFile(join(output,"memory-gate-benchmark-comparison.md"),"utf8"),/Interpretation boundary/);
}));
