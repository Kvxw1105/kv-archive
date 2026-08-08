import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeChatGPTConversation } from "../dist/packages/normalizer/src/index.js";
import { buildVaultIndexBundle, sha256Hex } from "../apps/extension/dist/vault-index.js";
import { createMemoryLibraryStore } from "../apps/extension/dist/library-store.js";
import {
  applyStateProposal,
  createEmptyProjectState,
  detectProposalConflicts,
  diffProjectStates,
  normalizeStateProposal,
  stableStateStringify,
} from "../apps/extension/dist/state-governance.js";

const fixture = JSON.parse(await readFile(new URL("../fixtures/synthetic/multi-branch-conversation.json", import.meta.url), "utf8"));

async function projectBundle() {
  const raw = structuredClone(fixture);
  raw.id = "state-project-conversation";
  raw.title = "AtlasDemo State Evidence";
  raw.mapping["user-1"].message.content.parts[0] = "AtlasDemo Batch 5 read-only MCP bridge is complete. Begin reviewed state proposals.";
  raw.mapping["assistant-active"].message.content.parts[0] = "The project should move to Batch 6 with approval-gated state writes.";
  const canonical = normalizeChatGPTConversation(raw, { adapter: "state-test" });
  return buildVaultIndexBundle({
    canonical,
    rawEvidence: raw,
    source: { kind: "context-vault", fileName: "state.zip", fingerprint: "state" },
    sourceMetadata: { locations: [{ type: "project", present: true, projectId: "project-atlasdemo", projectTitle: "AtlasDemo" }] },
    importedAt: "2026-07-26T00:00:00.000Z",
  });
}

function evidenceUri(bundle) {
  const message = bundle.messages.find((row) => row.activePath && row.role === "assistant") || bundle.messages[0];
  return `contextvault://conversation/${encodeURIComponent(bundle.conversation.conversationId)}/node/${encodeURIComponent(message.nodeId)}?evidence=${encodeURIComponent(message.evidenceHash)}`;
}

function proposal({ id, state, uri, kind = "project_status", change, title = "Update project state" }) {
  return normalizeStateProposal({
    format: "context-vault-state-proposal",
    schemaVersion: 1,
    id,
    createdAt: "2026-07-26T12:00:00.000Z",
    projectId: state.projectId,
    projectTitle: state.projectTitle,
    baseVersion: state.stateVersion,
    baseStateHash: state.stateHash,
    kind,
    title,
    rationale: "Grounded in the cited local evidence.",
    expectedImpact: "Update the approved project ledger after review.",
    riskLevel: "low",
    evidenceUris: [uri],
    change,
    agent: { name: "test-agent", bundleId: "test-bundle" },
  });
}

async function hashedEmptyState() {
  const state = createEmptyProjectState("project-atlasdemo", "AtlasDemo");
  state.stateHash = await sha256Hex(stableStateStringify(state));
  return state;
}

test("state proposal kinds apply deterministic status, decision, task and supersession changes", async () => {
  const uri = "contextvault://conversation/conv/node/node-1?evidence=hash";
  let state = await hashedEmptyState();
  const statusProposal = proposal({ id: "proposal-status", state, uri, change: { summary: "Batch 5 complete", phase: "Batch 6", health: "healthy", progressPercent: 75, blockers: [], nextActions: ["Review state proposals"] } });
  const statusNext = applyStateProposal(state, statusProposal, "2026-07-26T12:05:00.000Z");
  assert.equal(statusNext.stateVersion, 1);
  assert.equal(statusNext.status.phase, "Batch 6");
  assert(diffProjectStates(state, statusNext).some((row) => row.path === "status.phase"));

  state = { ...statusNext, stateHash: "state-v1" };
  const decisionProposal = proposal({ id: "proposal-decision", state, uri, kind: "decision", title: "Add evidence policy", change: { action: "add", record: { id: "decision-evidence", title: "Require evidence links", summary: "Every state proposal cites local evidence." } } });
  const decisionNext = applyStateProposal(state, decisionProposal, "2026-07-26T12:10:00.000Z");
  assert.equal(decisionNext.decisions[0].id, "decision-evidence");
  assert.deepEqual(decisionNext.decisions[0].evidenceUris, [uri]);

  state = { ...decisionNext, stateHash: "state-v2" };
  const taskProposal = proposal({ id: "proposal-task", state, uri, kind: "task", title: "Add review task", change: { action: "add", record: { id: "task-review", title: "Review Agent proposals", status: "todo", priority: "high" } } });
  const taskNext = applyStateProposal(state, taskProposal, "2026-07-26T12:15:00.000Z");
  assert.equal(taskNext.tasks[0].status, "todo");

  state = { ...taskNext, stateHash: "state-v3" };
  const supersedeProposal = proposal({ id: "proposal-supersede", state, uri, kind: "supersession", title: "Replace review task", change: { recordType: "task", targetId: "task-review", reason: "Split into a smaller verified task.", replacement: { id: "task-review-v2", title: "Review one proposal", status: "todo", priority: "medium" } } });
  const superseded = applyStateProposal(state, supersedeProposal, "2026-07-26T12:20:00.000Z");
  assert.equal(superseded.tasks.find((row) => row.id === "task-review").status, "superseded");
  assert(superseded.tasks.some((row) => row.id === "task-review-v2"));
  assert.equal(superseded.supersessions.length, 1);
});

test("review workflow validates evidence, versions approvals, preserves rejections, detects conflicts and rolls back", async () => {
  const store = createMemoryLibraryStore();
  const bundle = await projectBundle();
  await store.upsertBundle(bundle);
  const exported = await store.exportAgentRecords({ projectId: "project-atlasdemo" });
  assert.equal(exported.states.length, 1);
  const base = exported.states[0];
  assert.equal(base.stateVersion, 0);
  assert(base.stateHash);
  const uri = evidenceUri(bundle);

  const first = proposal({ id: "proposal-first", state: base, uri, change: { summary: "Batch 5 complete", phase: "Batch 6", health: "healthy", progressPercent: 80, blockers: [], nextActions: ["Review proposals"] } });
  const imported = await store.importStateProposal(first);
  assert.equal(imported.status, "pending");
  const review = await store.getStateProposalReview(first.id);
  assert.equal(review.conflicts.length, 0);
  assert(review.diff.some((row) => row.path === "status.summary"));
  const approved = await store.approveStateProposal(first.id, "Verified against MCP evidence.");
  assert.equal(approved.state.stateVersion, 1);
  assert.equal((await store.listStateVersions(base.projectId)).length, 2);
  assert.equal((await store.listStateProposals({ projectId: base.projectId }))[0].status, "approved");

  const stale = proposal({ id: "proposal-stale", state: base, uri, change: { summary: "Conflicting old status", phase: "Batch 5", health: "at_risk", progressPercent: 50, blockers: ["Old bundle"], nextActions: [] } });
  const staleImport = await store.importStateProposal(stale);
  assert.equal(staleImport.status, "conflicted");
  const staleReview = await store.getStateProposalReview(stale.id);
  assert(staleReview.conflicts.some((row) => row.code === "concurrent_change"));
  await assert.rejects(() => store.approveStateProposal(stale.id), /unresolved conflicts/);
  await store.rejectStateProposal(stale.id, "Generated from an outdated bundle.");
  assert.equal((await store.getProjectState(base.projectId)).stateVersion, 1);

  const current = await store.getProjectState(base.projectId);
  const task = proposal({ id: "proposal-task-current", state: current, uri, kind: "task", title: "Add Batch 6 task", change: { action: "add", record: { id: "task-batch6", title: "Ship reviewed state workflow", status: "in_progress", priority: "high", notes: "Keep approval local." } } });
  assert.equal((await store.importStateProposal(task)).status, "pending");
  const taskApproved = await store.approveStateProposal(task.id);
  assert.equal(taskApproved.state.stateVersion, 2);
  assert.equal(taskApproved.state.tasks[0].id, "task-batch6");

  const rollback = await store.rollbackProjectState(base.projectId, 0, "Return to an empty approved baseline for test.");
  assert.equal(rollback.state.stateVersion, 3);
  assert.equal(rollback.state.tasks.length, 0);
  assert.equal(rollback.state.status.summary, "");
  const events = await store.listStateEvents(base.projectId);
  assert(events.some((row) => row.type === "proposal_approved"));
  assert(events.some((row) => row.type === "proposal_rejected"));
  assert(events.some((row) => row.type === "state_rollback"));
});

test("proposal import rejects evidence that is not in the local evidence store", async () => {
  const store = createMemoryLibraryStore();
  const bundle = await projectBundle();
  await store.upsertBundle(bundle);
  const state = (await store.exportAgentRecords({ projectId: "project-atlasdemo" })).states[0];
  const invalid = proposal({ id: "proposal-invalid-evidence", state, uri: "contextvault://conversation/missing/node/missing?evidence=missing", change: { summary: "Invalid", phase: "Invalid", health: "blocked" } });
  await assert.rejects(() => store.importStateProposal(invalid), /evidence validation failed/);
});

test("conflict detector allows an old proposal when unrelated records changed", async () => {
  const base = await hashedEmptyState();
  const uri = "contextvault://conversation/conv/node/node-1?evidence=hash";
  const decision = proposal({ id: "proposal-unrelated", state: base, uri, kind: "decision", change: { action: "add", record: { id: "decision-a", title: "Decision A" } } });
  const current = { ...base, stateVersion: 1, stateHash: "new", tasks: [{ id: "task-other", title: "Other", status: "todo", priority: "medium", owner: null, dueDate: null, notes: "", evidenceUris: [], createdAt: null, updatedAt: null, supersededAt: null, supersededByProposalId: null }] };
  const conflicts = detectProposalConflicts({ proposal: decision, baseState: base, currentState: current });
  assert.equal(conflicts.length, 0);
});

test("partial status and record updates preserve unspecified approved fields", async () => {
  const uri = "contextvault://conversation/conv/node/node-1?evidence=hash";
  let state = await hashedEmptyState();
  const seeded = applyStateProposal(state, proposal({
    id: "proposal-seed-partial",
    state,
    uri,
    change: {
      summary: "Stable summary",
      phase: "Batch 6",
      health: "healthy",
      progressPercent: 70,
      blockers: ["One blocker"],
      nextActions: ["Keep going"],
    },
  }), "2026-07-26T13:00:00.000Z");
  state = { ...seeded, stateHash: "seeded-status" };
  const statusOnly = applyStateProposal(state, proposal({
    id: "proposal-partial-status",
    state,
    uri,
    change: { progressPercent: 75 },
  }), "2026-07-26T13:05:00.000Z");
  assert.equal(statusOnly.status.progressPercent, 75);
  assert.equal(statusOnly.status.summary, "Stable summary");
  assert.equal(statusOnly.status.phase, "Batch 6");
  assert.deepEqual(statusOnly.status.blockers, ["One blocker"]);
  assert.deepEqual(statusOnly.status.nextActions, ["Keep going"]);

  state = { ...statusOnly, stateHash: "seeded-records" };
  const addedDecision = applyStateProposal(state, proposal({
    id: "proposal-add-decision-partial",
    state,
    uri,
    kind: "decision",
    change: { action: "add", record: { id: "decision-preserve", title: "Preserve fields", summary: "Original summary", consequences: ["Original consequence"] } },
  }), "2026-07-26T13:10:00.000Z");
  state = { ...addedDecision, stateHash: "decision-added" };
  const updatedDecision = applyStateProposal(state, proposal({
    id: "proposal-update-decision-partial",
    state,
    uri,
    kind: "decision",
    change: { action: "update", record: { id: "decision-preserve", status: "superseded" } },
  }), "2026-07-26T13:15:00.000Z");
  const decision = updatedDecision.decisions.find((row) => row.id === "decision-preserve");
  assert.equal(decision.status, "superseded");
  assert.equal(decision.title, "Preserve fields");
  assert.equal(decision.summary, "Original summary");
  assert.deepEqual(decision.consequences, ["Original consequence"]);

  state = { ...updatedDecision, stateHash: "decision-updated" };
  const addedTask = applyStateProposal(state, proposal({
    id: "proposal-add-task-partial",
    state,
    uri,
    kind: "task",
    change: { action: "add", record: { id: "task-preserve", title: "Preserve task", status: "in_progress", priority: "high", owner: "KV", dueDate: "2026-08-01", notes: "Original notes" } },
  }), "2026-07-26T13:20:00.000Z");
  state = { ...addedTask, stateHash: "task-added" };
  const updatedTask = applyStateProposal(state, proposal({
    id: "proposal-update-task-partial",
    state,
    uri,
    kind: "task",
    change: { action: "update", record: { id: "task-preserve", status: "done" } },
  }), "2026-07-26T13:25:00.000Z");
  const task = updatedTask.tasks.find((row) => row.id === "task-preserve");
  assert.equal(task.status, "done");
  assert.equal(task.title, "Preserve task");
  assert.equal(task.priority, "high");
  assert.equal(task.owner, "KV");
  assert.equal(task.dueDate, "2026-08-01");
  assert.equal(task.notes, "Original notes");
});

test("partial proposals reject empty changes and invalid enum values", async () => {
  const state = await hashedEmptyState();
  const uri = "contextvault://conversation/conv/node/node-1?evidence=hash";
  assert.throws(() => proposal({ id: "proposal-empty-status", state, uri, change: {} }), /at least one field/);
  assert.throws(() => proposal({ id: "proposal-invalid-health", state, uri, change: { health: "excellent" } }), /Invalid project health/);
  assert.throws(() => proposal({ id: "proposal-empty-task-update", state, uri, kind: "task", change: { action: "update", record: { id: "task-a" } } }), /must change at least one field/);
});
