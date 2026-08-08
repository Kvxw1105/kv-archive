import test from "node:test";
import assert from "node:assert/strict";
import { buildMemoryBundle, buildMemoryPackage, diffMemoryMarkdown, estimateMemoryTokens } from "../apps/extension/dist/memory-core.js";
import { createMemoryLibraryStore } from "../apps/extension/dist/library-store.js";
import { createEmptyProjectState } from "../apps/extension/dist/state-governance.js";
import { readZipEntries } from "../apps/extension/dist/zip-reader.js";

function records() {
  const projectId = "project-memory";
  const state = createEmptyProjectState(projectId, "Memory Project");
  state.stateVersion = 3;
  state.stateHash = "state-hash";
  state.status = { summary:"Build a durable memory sync workflow.", phase:"Batch 7C", health:"good", progressPercent:72, blockers:["Real browser acceptance pending"], nextActions:["Approve memory package","Insert into ChatGPT"] };
  state.decisions = [{ id:"d1", title:"Use reviewed memory", summary:"Never mutate native memory silently.", status:"active", consequences:[], evidenceUris:["contextvault://conversation/conv-memory/node/a1?evidence=hash1"], createdAt:null, updatedAt:null, supersededAt:null, supersededByProposalId:null }];
  state.tasks = [{ id:"t1", title:"Ship Memory Center", status:"in_progress", priority:"high", owner:"ContextVault", dueDate:null, notes:"Add diff, copy and injection.", evidenceUris:["contextvault://conversation/conv-memory/node/a1?evidence=hash1"], createdAt:null, updatedAt:null, supersededAt:null, supersededByProposalId:null }];
  const conversation = { key:"chatgpt:conv-memory", conversationId:"conv-memory", title:"Memory Sync Design", projectId, projectTitle:"Memory Project", updatedAt:"2026-07-26T12:00:00.000Z" };
  const messages = [
    { key:"chatgpt:conv-memory:u1", conversationKey:conversation.key, conversationId:conversation.conversationId, nodeId:"u1", evidenceHash:"hash1", role:"user", text:"How should ContextVault sync memory without wasting tokens?", normalizedText:"how should contextvault sync memory without wasting tokens?", activePath:true, createdAt:"2026-07-26T11:00:00.000Z" },
    { key:"chatgpt:conv-memory:a1", conversationKey:conversation.key, conversationId:conversation.conversationId, nodeId:"a1", evidenceHash:"hash1", role:"assistant", text:"Use core, project, and task memory tiers with evidence citations.", normalizedText:"use core project and task memory tiers with evidence citations", activePath:true, createdAt:"2026-07-26T11:01:00.000Z" },
  ];
  return { conversations:[conversation], messages, evidence:[], states:[state] };
}

test("memory packages are deterministic, cited and budget bounded", async () => {
  const input = records();
  const first = await buildMemoryPackage(input,{projectId:"project-memory",mode:"task",query:"memory tokens",budgetTokens:2048,generatedAt:"2026-07-26T12:00:00.000Z"});
  const second = await buildMemoryPackage(input,{projectId:"project-memory",mode:"task",query:"memory tokens",budgetTokens:2048,generatedAt:"2026-07-26T12:00:00.000Z"});
  assert.equal(first.hash,second.hash);
  assert.equal(first.markdown,second.markdown);
  assert(first.estimatedTokens <= 2048);
  assert.match(first.markdown,/contextvault:\/\/conversation\//);
  assert.match(first.markdown,/当前任务/);
  assert.equal(first.estimatedTokens,estimateMemoryTokens(first.markdown));
});

test("approved memory is versioned and exportable", async () => {
  const input=records();
  const core=await buildMemoryPackage(input,{projectId:"project-memory",mode:"core",generatedAt:"2026-07-26T12:00:00.000Z"});
  const project=await buildMemoryPackage(input,{projectId:"project-memory",mode:"project",generatedAt:"2026-07-26T12:00:00.000Z"});
  const candidate={projectId:core.projectId,projectTitle:core.projectTitle,sourceStateVersion:core.sourceStateVersion,sourceStateHash:core.sourceStateHash,core,project,hash:`${core.hash}:${project.hash}`};
  const store=createMemoryLibraryStore();
  store.state.projectStates.set(candidate.projectId, structuredClone(input.states[0]));
  const approved1=await store.approveMemoryPackage(candidate,"reviewed");
  const duplicate=await store.approveMemoryPackage(candidate,"reviewed again");
  assert.equal(approved1.version,1);
  assert.equal(duplicate.version,1);
  assert.equal((await store.listMemoryVersions(candidate.projectId)).length,1);
  const changed={...candidate,hash:`changed-${candidate.hash}`,project:{...candidate.project,markdown:`${candidate.project.markdown}
- changed
`}};
  const approved2=await store.approveMemoryPackage(changed,"reviewed changed memory");
  assert.equal(approved2.version,2);
  assert.equal((await store.listMemoryVersions(candidate.projectId)).length,2);
  const bundle=buildMemoryBundle(approved2);
  const entries=await readZipEntries(bundle.bytes);
  assert(entries.has("manifest.json"));
  assert(entries.has("00_CORE_MEMORY.md"));
  assert(entries.has("01_PROJECT_MEMORY.md"));
  assert(entries.has("02_EVIDENCE_INDEX.md"));
});

test("memory diff reports added and removed lines", () => {
  const diff=diffMemoryMarkdown("# A\n- old\n","# A\n- new\n");
  assert.deepEqual(diff.removed,["- old"]);
  assert.deepEqual(diff.added,["- new"]);
  assert.equal(diff.changed,2);
});
