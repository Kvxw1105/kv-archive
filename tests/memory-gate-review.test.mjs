import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMemoryLibraryStore } from "../apps/extension/dist/library-store.js";
import { normalizeProjectState } from "../apps/extension/dist/state-governance.js";
import { buildProjectMemoryCandidates, evaluateMemoryGate } from "../apps/extension/dist/memory-gate-core.js";

test("Memory Center exposes a local Gate review table and receipt controls", async () => {
  const html = await readFile("apps/extension/src/memory.html", "utf8");
  for (const id of ["gate-policy","gate-target","gate-budget","run-gate","export-gate","gate-results","gate-runs"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  const source = await readFile("apps/extension/src/memory.js", "utf8");
  assert.match(source, /buildProjectMemoryCandidates/);
  assert.match(source, /saveMemoryGateRun/);
  assert.match(source, /restoreMemoryGateConfigFromRun/);
  assert.doesNotMatch(source, /approveStateProposal|rollbackProjectState/);
});

test("Memory Gate configs and immutable run receipts can be restored locally", async () => {
  const store = createMemoryLibraryStore();
  const config = await store.saveMemoryGateConfig({ projectId:"p", projectTitle:"Project", policy:"safe", target:"external", tokenBudget:512 });
  assert.equal(config.version, 1);
  const report = { counts:{INCLUDE:1,EXCLUDE:0,REVIEW:1}, candidates:[], included:[], excluded:[], reviewRequired:[], policy:"safe", target:"external", tokenBudget:512, usedTokens:64 };
  const run = await store.saveMemoryGateRun({ id:"fixed-run", projectId:"p", projectTitle:"Project", config, report, sourceStateVersion:2, sourceStateHash:"hash" });
  assert.ok(run.hash);
  await assert.rejects(()=>store.saveMemoryGateRun({ id:"fixed-run", projectId:"p", config, report }),/already exists/);
  assert.equal((await store.listMemoryGateRuns("p")).length, 1);
  const changed = await store.saveMemoryGateConfig({ projectId:"p", policy:"broad", target:"internal", tokenBudget:8192 });
  assert.equal(changed.version, 2);
  const restored = await store.restoreMemoryGateConfigFromRun(run.id);
  assert.equal(restored.version, 3);
  assert.equal(restored.policy, "safe");
  assert.equal(restored.target, "external");
  assert.equal(restored.rollbackFromRunId, run.id);
});

test("optional governance metadata survives Project State v1 and influences Gate decisions", () => {
  const state = normalizeProjectState({
    projectId:"p", projectTitle:"Project", stateVersion:1,
    decisions:[{ id:"d", title:"Restricted decision", status:"active", summary:"Private", sensitivity:"restricted", locked:true, importance:99, scope:"p", expiresAt:null, conflictsWith:[], evidenceUris:["contextvault://conversation/c/node/n?evidence=h"] }],
    tasks:[], status:{}, supersessions:[],
  });
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.decisions[0].sensitivity, "restricted");
  assert.equal(state.decisions[0].locked, true);
  const candidates = buildProjectMemoryCandidates(state, { verifyEvidence:()=>true });
  const report = evaluateMemoryGate(candidates, { projectId:"p", target:"external", policy:"balanced", tokenBudget:2048, generatedAt:"2026-07-28T12:00:00.000Z" });
  const row = report.candidates.find((item)=>item.candidate.id==="decision:d");
  assert.equal(row.decision, "EXCLUDE");
  assert.ok(row.reasonCodes.includes("SENSITIVE_EXTERNAL_TARGET"));
});

test("extension and Agent use the same synchronized Memory Gate implementation", async () => {
  const agent = await readFile("apps/agent/src/memory-gate.js", "utf8");
  const extension = await readFile("apps/extension/src/memory-gate-core.js", "utf8");
  assert.equal(extension, agent);
});


test("invalid expiry metadata requires review instead of silently acting as no expiry", () => {
  const report=evaluateMemoryGate([{id:"bad-expiry",projectId:"p",title:"Bad expiry",text:"Review me",kind:"decision",expiresAt:"not-a-date",evidenceUris:["ok"]}],{projectId:"p",policy:"balanced",tokenBudget:2048,generatedAt:"2026-07-28T12:00:00.000Z"});
  assert.equal(report.reviewRequired[0].candidate.id,"bad-expiry");
  assert.ok(report.reviewRequired[0].reasonCodes.includes("INVALID_EXPIRY"));
});
