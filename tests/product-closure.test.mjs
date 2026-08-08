import test from "node:test";
import assert from "node:assert/strict";
import { createDraftStore } from "../apps/extension/src/draft-store.js";
import { relationSelectionState, restoreUndoMode } from "../apps/extension/src/capture-ux.js";
import { resolveProjectSelection, slugifyProject } from "../apps/extension/src/project-identity.js";
import { createMemoryLibraryStore } from "../apps/extension/src/library-store.js";
import { buildMemoryPackage } from "../apps/extension/src/memory-core.js";

function memoryStorage() {
  const rows = new Map();
  return { getItem: (key) => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: (key) => rows.delete(key) };
}

test("existing project selection alone does not create a fake unsaved draft", () => {
  const store = createDraftStore({ storage: memoryStorage(), key: "draft" });
  assert.equal(store.save({ projectId: "p1", projectTitle: "Project One" }), null);
  const saved = store.save({ newProjectTitle: "新项目" });
  assert.equal(saved.newProjectTitle, "新项目");
  assert.equal(store.load().newProjectTitle, "新项目");
});

test("project identity is deterministic and new project wins over selected project", () => {
  assert.equal(slugifyProject(" KV Archive 测试 "), "kv-archive-测试");
  assert.deepEqual(resolveProjectSelection({ selectedId: "old", selectedTitle: "旧项目", newTitle: "新项目" }), {
    id: "新项目",
    title: "新项目",
    created: true,
  });
});

test("project creation reuses exact names and blocks normalized id collisions", () => {
  assert.deepEqual(resolveProjectSelection({ newTitle: "Project One", existingProjects: [{ id: "project-one", title: "Project One" }] }), {
    id: "project-one",
    title: "Project One",
    created: false,
  });
  assert.throws(
    () => resolveProjectSelection({ newTitle: "Project-One", existingProjects: [{ id: "project-one", title: "Project One" }] }),
    /产生相同标识/,
  );
});

test("capture restore and relation controls preserve the real prior state", () => {
  assert.equal(restoreUndoMode({ status: "archived" }), "archive");
  assert.equal(restoreUndoMode({ status: "trashed" }), "trash");
  assert.deepEqual(relationSelectionState(["a"], "a", "a"), { ready: false, fromId: "a", toId: "" });
  assert.deepEqual(relationSelectionState(["a", "b"], "a", "a"), { ready: true, fromId: "a", toId: "b" });
});

test("note-only projects are discoverable by the shared project catalog", async () => {
  const store = createMemoryLibraryStore();
  store.state.captureItems.set("n1", { id: "n1", projectId: "notes-project", projectTitle: "Notes Project" });
  assert.deepEqual(await store.listStateProjects(), [{ id: "notes-project", title: "Notes Project" }]);
  const records = await store.exportAgentRecords({ projectId: "notes-project" });
  assert.equal(records.states.length, 1);
  assert.equal(records.states[0].projectTitle, "Notes Project");
});

test("project context includes local notes as stable evidence", async () => {
  const state = {
    projectId: "p1", projectTitle: "Project One", stateVersion: 0, stateHash: "sha256:state", updatedAt: "2026-08-06T00:00:00.000Z",
    status: { phase: "planning", health: "healthy", progressPercent: 10, summary: "开始", blockers: [], nextActions: [] },
    decisions: [], tasks: [], protectedAreas: [],
  };
  const note = {
    id: "note-1", projectId: "p1", projectTitle: "Project One", kind: "note", status: "active", revision: 2,
    contentHash: "sha256:note", title: "关键笔记", body: "必须保留这条本地笔记。", tags: ["important"], updatedAt: "2026-08-06T01:00:00.000Z",
  };
  const result = await buildMemoryPackage({ states: [state], conversations: [], messages: [], contentObjects: [note] }, { projectId: "p1", mode: "project", budgetTokens: 8192 });
  assert.match(result.markdown, /项目记录/);
  assert.match(result.markdown, /关键笔记/);
  assert.match(result.markdown, /必须保留这条本地笔记/);
  assert.ok(result.sources.some((uri) => uri.startsWith("contextvault://content/note-1?revision=2")));
});

test("clearing the searchable library preserves governed project data", async () => {
  const store = createMemoryLibraryStore();
  store.state.imports.push({ id: "import-1" });
  store.state.conversations.set("c1", { key: "c1", projectId: "p1" });
  store.state.evidence.set("e1", { key: "e1" });
  store.state.messages.set("m1", { key: "m1", conversationKey: "c1" });
  store.state.postings.set("t1", { key: "t1", conversationKey: "c1" });
  store.state.projectStates.set("p1", { projectId: "p1", stateVersion: 1 });
  store.state.stateVersions.set("p1:v1", { projectId: "p1", version: 1 });
  store.state.proposals.set("proposal-1", { id: "proposal-1", projectId: "p1" });
  store.state.events.push({ id: "event-1", projectId: "p1" });
  store.state.memoryProfiles.set("p1", { projectId: "p1", version: 1 });
  store.state.memoryVersions.set("p1:v1", { projectId: "p1", version: 1 });
  store.state.memoryEvents.push({ id: "memory-event-1", projectId: "p1" });
  store.state.memoryGateConfigs.set("cfg", { id: "cfg", projectId: "p1" });
  store.state.memoryGateRuns.set("run", { id: "run", projectId: "p1" });
  store.state.knowledgeExportProfiles.set("p1", { projectId: "p1" });
  store.state.knowledgeExportPaths.set("p1:n1", { nodeId: "n1" });
  store.state.knowledgeExportRuns.set("export-1", { id: "export-1", projectId: "p1" });
  store.state.captureItems.set("note-1", { id: "note-1", projectId: "p1" });

  await store.clear();

  assert.equal(store.state.imports.length, 0);
  assert.equal(store.state.conversations.size, 0);
  assert.equal(store.state.evidence.size, 1);
  assert.equal(store.state.messages.size, 0);
  assert.equal(store.state.postings.size, 0);
  assert.equal(store.state.projectStates.size, 1);
  assert.equal(store.state.stateVersions.size, 1);
  assert.equal(store.state.proposals.size, 1);
  assert.equal(store.state.events.length, 1);
  assert.equal(store.state.memoryProfiles.size, 1);
  assert.equal(store.state.memoryVersions.size, 1);
  assert.equal(store.state.memoryEvents.length, 1);
  assert.equal(store.state.memoryGateConfigs.size, 1);
  assert.equal(store.state.memoryGateRuns.size, 1);
  assert.equal(store.state.knowledgeExportProfiles.size, 1);
  assert.equal(store.state.knowledgeExportPaths.size, 1);
  assert.equal(store.state.knowledgeExportRuns.size, 1);
  assert.equal(store.state.captureItems.size, 1);
});

test("search implementation does not silently truncate candidate messages", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../apps/extension/src/library-store.js", import.meta.url), "utf8"));
  assert.doesNotMatch(source, /candidateKeys\]\s*\.slice\(0,\s*5000\)/);
  assert.match(source, /recordsForKeys\(db, MESSAGES, \[\.\.\.candidateKeys\]\)/);
});

test("large project histories and mobile detail logs expose incremental viewing", async () => {
  const fs = await import("node:fs/promises");
  const [stateSource, memorySource, captureSource, pwaSource] = await Promise.all([
    fs.readFile(new URL("../apps/extension/src/state.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../apps/extension/src/memory.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../apps/extension/src/capture.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../apps/pwa/src/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(stateSource, /data-proposals-more/);
  assert.match(stateSource, /data-versions-more/);
  assert.match(memorySource, /data-memory-versions-more/);
  assert.match(captureSource, /data-detail-more/);
  assert.match(captureSource, /data-receipts-more/);
  assert.match(pwaSource, /data-detail-operations-more/);
  assert.match(pwaSource, /data-detail-relations-more/);
});

test("Agent export uses project-scoped reads before loading selected messages and evidence", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../apps/extension/src/library-store.js", import.meta.url), "utf8"));
  const block = source.slice(source.indexOf("async exportAgentRecords(filters = {})"), source.indexOf("async listStateProjects()"));
  assert.doesNotMatch(block, /objectStore\(MESSAGES\)\.getAll\(\)/);
  assert.doesNotMatch(block, /objectStore\(EVIDENCE\)\.getAll\(\)/);
  assert.match(block, /conversationStore\.index\("projectId"\)\.getAll\(IDBKeyRange\.only\(projectId\)\)/);
  assert.match(block, /captureStore\.index\("projectId"\)\.getAll\(IDBKeyRange\.only\(projectId\)\)/);
  assert.match(block, /stateStore\.get\(projectId\)/);
  assert.match(block, /recordsForIndexValues\(db, MESSAGES, "conversationKey", conversationKeys\)/);
  assert.match(block, /recordsForKeys\(db, EVIDENCE, evidenceKeys\)/);
});

test("Project Capture export reads versions by selected object ids instead of scanning version history", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../apps/extension/src/capture-store.js", import.meta.url), "utf8"));
  const start = source.indexOf("    async exportRecords(filters = {})");
  const block = source.slice(start, source.indexOf("    async analyzePortablePackage", start));
  assert.match(block, /recordsForIndexValues\(db, VERSIONS, "objectId", \[\.\.\.ids\]\)/);
  assert.doesNotMatch(block, /this\.listAllVersions\(projectId\)/);
});

test("current package builders do not fall back to stale v0.16.7 metadata", async () => {
  const fs = await import("node:fs/promises");
  const [agentBundle, capturePackage] = await Promise.all([
    fs.readFile(new URL("../apps/extension/src/agent-bundle.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../apps/extension/src/capture-package.js", import.meta.url), "utf8"),
  ]);
  assert.match(agentBundle, /sourceAppVersion: options\.sourceAppVersion \|\| "0\.16\.11"/);
  assert.match(capturePackage, /sourceAppVersion: options\.sourceAppVersion \|\| "0\.16\.11"/);
  assert.doesNotMatch(agentBundle, /sourceAppVersion: options\.sourceAppVersion \|\| "0\.16\.7"/);
  assert.doesNotMatch(capturePackage, /sourceAppVersion: options\.sourceAppVersion \|\| "0\.16\.7"/);
});

