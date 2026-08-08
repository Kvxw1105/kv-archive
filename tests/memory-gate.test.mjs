import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildProjectMemoryCandidates, evaluateMemoryGate, renderMemoryGateMarkdown } from "../apps/agent/src/memory-gate.js";
import { AgentRepository } from "../apps/agent/src/agent-core.js";
import { buildAgentBundle } from "../apps/extension/dist/agent-bundle.js";

function projectState() {
  return {
    format: "context-vault-project-state",
    schemaVersion: 1,
    projectId: "project-kv",
    projectTitle: "KV Archive",
    stateVersion: 5,
    stateHash: "state-hash",
    updatedAt: "2026-07-28T10:00:00.000Z",
    status: {
      summary: "Multi-provider foundation is complete; real provider acceptance remains pending.",
      phase: "Memory Gate",
      health: "at_risk",
      progressPercent: 78,
      blockers: ["Real Voice transcript acceptance is pending."],
      nextActions: ["Implement deterministic Memory Gate."],
    },
    decisions: [
      { id: "d-active", title: "Preserve raw evidence", summary: "Never overwrite raw evidence.", status: "active", consequences: [], evidenceUris: ["contextvault://conversation/conv-1/node/a1?evidence=hash-1"], createdAt: "2026-07-28T08:00:00.000Z", updatedAt: null, supersededAt: null, supersededByProposalId: null },
      { id: "d-old", title: "Old decision", summary: "No longer valid.", status: "superseded", consequences: [], evidenceUris: [], createdAt: null, updatedAt: null, supersededAt: null, supersededByProposalId: "p-new" },
      { id: "d-review", title: "Uncited decision", summary: "Needs evidence.", status: "active", consequences: [], evidenceUris: [], createdAt: null, updatedAt: null, supersededAt: null, supersededByProposalId: null },
    ],
    tasks: [
      { id: "t-active", title: "Build gate CLI", status: "in_progress", priority: "high", owner: "KV", dueDate: null, notes: "Produce deterministic reports.", evidenceUris: ["contextvault://conversation/conv-1/node/a1?evidence=hash-1"], createdAt: null, updatedAt: null, supersededAt: null, supersededByProposalId: null },
      { id: "t-done", title: "Old completed task", status: "done", priority: "medium", owner: null, dueDate: null, notes: "Done.", evidenceUris: [], createdAt: null, updatedAt: null, supersededAt: null, supersededByProposalId: null },
    ],
    supersessions: [],
    lastProposalId: null,
  };
}

function repositoryBundle() {
  const conversation = { key: "chatgpt:conv-1", conversationId: "conv-1", title: "Memory Gate evidence", projectId: "project-kv", projectTitle: "KV Archive", updatedAt: "2026-07-28T09:00:00.000Z", messageCount: 1, activeMessageCount: 1, sourceKinds: ["chatgpt"], currentEvidenceHash: "hash-1", currentEvidenceKey: "ev-1" };
  const message = { key: "chatgpt:conv-1:a1", conversationKey: conversation.key, conversationId: "conv-1", nodeId: "a1", messageId: "a1", evidenceHash: "hash-1", role: "assistant", text: "Memory Gate must exclude superseded records and explain every decision.", activePath: true, createdAt: "2026-07-28T09:00:00.000Z" };
  return { manifest: { format: "context-vault-agent-bundle", version: 2, bundleId: "bundle-gate", createdAt: "2026-07-28T10:00:00.000Z" }, conversations: [conversation], messages: [message], evidence: [{ key: "ev-1", evidenceHash: "hash-1", conversationId: "conv-1" }], states: [projectState()] };
}

test("Memory Gate deterministically separates include, exclude, and review", () => {
  const candidates = buildProjectMemoryCandidates(projectState(), { verifyEvidence: (uri) => uri.includes("hash-1") });
  const first = evaluateMemoryGate(candidates, { projectId: "project-kv", policy: "balanced", tokenBudget: 4096, generatedAt: "2026-07-28T12:00:00.000Z" });
  const second = evaluateMemoryGate(candidates, { projectId: "project-kv", policy: "balanced", tokenBudget: 4096, generatedAt: "2026-07-28T12:00:00.000Z" });
  assert.deepEqual(first, second);
  assert(first.included.some((row) => row.candidate.id === "decision:d-active"));
  assert(first.excluded.some((row) => row.candidate.id === "decision:d-old" && row.reasonCodes.includes("SUPERSEDED")));
  assert(first.excluded.some((row) => row.candidate.id === "task:t-done" && row.reasonCodes.includes("INACTIVE_RECORD")));
  assert(first.reviewRequired.some((row) => row.candidate.id === "decision:d-review" && row.reasonCodes.includes("MISSING_EVIDENCE")));
  assert.match(renderMemoryGateMarkdown(first), /Included memory/);
});

test("broad policy can include missing evidence but invalid evidence still requires review", () => {
  const candidates = [
    { id: "missing", projectId: "p", title: "Missing", text: "No citation", kind: "decision", evidenceUris: [] },
    { id: "invalid", projectId: "p", title: "Invalid", text: "Bad citation", kind: "decision", evidenceUris: ["bad"], invalidEvidenceUris: ["bad"] },
    { id: "other", projectId: "other", title: "Other", text: "Wrong scope", kind: "decision" },
  ];
  const report = evaluateMemoryGate(candidates, { projectId: "p", policy: "broad", tokenBudget: 2048, generatedAt: "2026-07-28T12:00:00.000Z" });
  assert(report.included.some((row) => row.candidate.id === "missing" && row.warnings.includes("MISSING_EVIDENCE_ALLOWED_BY_BROAD_POLICY")));
  assert(report.reviewRequired.some((row) => row.candidate.id === "invalid"));
  assert(report.excluded.some((row) => row.candidate.id === "other" && row.reasonCodes.includes("CROSS_PROJECT_SCOPE")));
});


test("safe and balanced policies differ for approved high-priority tasks without evidence", () => {
  const candidate = { id: "task-no-evidence", projectId: "p", title: "Urgent task", text: "Needs execution", kind: "task", priority: "high", source: "approved_record", evidenceUris: [] };
  const safe = evaluateMemoryGate([candidate], { projectId: "p", policy: "safe", tokenBudget: 2048, generatedAt: "2026-07-28T12:00:00.000Z" });
  const balanced = evaluateMemoryGate([candidate], { projectId: "p", policy: "balanced", tokenBudget: 2048, generatedAt: "2026-07-28T12:00:00.000Z" });
  assert.equal(safe.counts.REVIEW, 1);
  assert.equal(balanced.counts.INCLUDE, 1);
  assert(balanced.included[0].warnings.includes("MISSING_EVIDENCE_APPROVED_HIGH_PRIORITY_TASK"));
});

test("external target reviews internal memory and excludes restricted memory", () => {
  const report = evaluateMemoryGate([
    { id: "internal", projectId: "p", title: "Internal", text: "Internal context", kind: "decision", sensitivity: "internal", evidenceUris: ["ok"] },
    { id: "restricted", projectId: "p", title: "Restricted", text: "Secret", kind: "decision", sensitivity: "restricted", evidenceUris: ["ok"] },
  ], { projectId: "p", policy: "balanced", target: "external", tokenBudget: 2048, generatedAt: "2026-07-28T12:00:00.000Z" });
  assert(report.reviewRequired.some((row) => row.candidate.id === "internal" && row.reasonCodes.includes("INTERNAL_MEMORY_EXTERNAL_TARGET")));
  assert(report.excluded.some((row) => row.candidate.id === "restricted" && row.reasonCodes.includes("SENSITIVE_EXTERNAL_TARGET")));
});

test("locked approved memory survives a tiny budget and reports overrun", () => {
  const report = evaluateMemoryGate([{ id: "locked", projectId: "p", title: "Critical", text: "x".repeat(1000), kind: "blocker", locked: true, source: "approved_project_state", evidenceUris: ["contextvault://project/p/state/1#blocker"] }], { projectId: "p", tokenBudget: 128, generatedAt: "2026-07-28T12:00:00.000Z" });
  assert.equal(report.counts.INCLUDE, 1);
  assert(report.budgetOverrun > 0);
});

test("Agent repository gates approved memory before building a Context Pack", () => {
  const repository = new AgentRepository(repositoryBundle());
  const report = repository.runMemoryGate({ project: "KV Archive", policy: "balanced", tokenBudget: 2048, generatedAt: "2026-07-28T12:00:00.000Z" });
  assert.equal(report.projectId, "project-kv");
  assert(report.included.some((row) => row.candidate.id === "decision:d-active"));
  const pack = repository.buildContextPack({ query: "Memory Gate", projectTitle: "KV Archive", budgetTokens: 8192, memoryGatePolicy: "balanced", generatedAt: "2026-07-28T12:00:00.000Z" });
  assert.equal(pack.memoryGate.policy, "balanced");
  assert.match(pack.markdown, /KV Archive · Memory Gate/);
  assert.match(pack.markdown, /Preserve raw evidence/);
  assert.doesNotMatch(pack.markdown, /Old decision/);
});

test("packaged CLI writes the complete Memory Gate report set", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kv-memory-gate-"));
  try {
    const built = await buildAgentBundle({ conversations: repositoryBundle().conversations, messages: repositoryBundle().messages, evidence: repositoryBundle().evidence, states: repositoryBundle().states }, { filters: {} });
    const bundlePath = join(directory, built.filename);
    await writeFile(bundlePath, built.bytes);
    const output = join(directory, "gate");
    const result = spawnSync(process.execPath, ["apps/agent-bridge/dist/agent/index.js", "memory-gate", "--bundle", bundlePath, "--project", "KV Archive", "--policy", "balanced", "--token-budget", "2048", "--output", output, "--generated-at", "2026-07-28T12:00:00.000Z"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    for (const name of ["memory-gate-manifest.json", "memory-gate-report.json", "memory-gate-report.md", "included-memories.json", "excluded-memories.json", "review-required.json"]) await readFile(join(output, name), "utf8");
    const report = JSON.parse(await readFile(join(output, "memory-gate-report.json"), "utf8"));
    assert.equal(report.projectId, "project-kv");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
