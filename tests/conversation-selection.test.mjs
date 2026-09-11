import test from "node:test";
import assert from "node:assert/strict";
import {
  createConversationSelectionSet,
  filterConversationRefs,
  toggleConversationSelection,
} from "../apps/extension/dist/conversation-selection.js";
import {
  createSelectedConversationJob,
  runSelectedConversationExport,
} from "../apps/extension/dist/history-engine.js";

function rawConversation(id, title) {
  return {
    id,
    title,
    current_node: `${id}-a`,
    mapping: {
      [`${id}-u`]: { id: `${id}-u`, parent: null, children: [`${id}-a`], message: { id: `${id}-mu`, author: { role: "user" }, content: { content_type: "text", parts: ["Q"] } } },
      [`${id}-a`]: { id: `${id}-a`, parent: `${id}-u`, children: [], message: { id: `${id}-ma`, author: { role: "assistant" }, content: { content_type: "text", parts: ["A"] } } },
    },
  };
}

function memoryStore() {
  const jobs = new Map();
  const artifacts = new Map();
  return {
    async getLatestJob(id) { return jobs.get(id) ?? null; },
    async saveJob(job) { jobs.set(job.id, structuredClone(job)); },
    async putArtifact(jobId, conversationId, artifact) { artifacts.set(`${jobId}:${conversationId}`, structuredClone(artifact)); },
    async getArtifact(jobId, conversationId) { return artifacts.get(`${jobId}:${conversationId}`) ?? null; },
    async listArtifactIds(jobId) { return [...artifacts.keys()].filter((key) => key.startsWith(`${jobId}:`)).map((key) => key.slice(jobId.length + 1)); },
    async listAssetKeys() { return []; },
    async listAssetMetadata() { return []; },
    async getAsset() { return null; },
    async deleteAsset() {},
  };
}

const refs = [
  { provider: "chatgpt", accountScopeId: "ws-1", conversationId: "c-1", title: "Mobile notes", updatedAt: 3, primaryCollectionId: "p-1", collectionRefs: [{ provider: "chatgpt", collectionId: "p-1", kind: "project", title: "KV Archive" }] },
  { provider: "chatgpt", accountScopeId: "ws-1", conversationId: "c-2", title: "Memory Gate", updatedAt: 2 },
];

test("selection sets deduplicate conversations and support filters and toggles", () => {
  let selection = createConversationSelectionSet({ title: "Batch", refs: [refs[0], refs[0]] });
  assert.equal(selection.items.length, 1);
  selection = toggleConversationSelection(selection, refs[1], true);
  assert.equal(selection.items.length, 2);
  assert.equal(filterConversationRefs(selection.items, "memory").length, 1);
  assert.equal(filterConversationRefs(selection.items, "", { collectionId: "p-1" }).length, 1);
});

test("selection filters preserve platform identity", () => {
  const mixed = [...refs, { provider: "gemini", accountScopeId: "personal", conversationId: "g-1", title: "Gemini note", updatedAt: 1 }];
  assert.deepEqual(filterConversationRefs(mixed, "", { provider: "gemini" }).map((item) => item.key), ["gemini:personal:g-1"]);
  assert.deepEqual(new Set(createConversationSelectionSet({ title: "Mixed", refs: mixed }).items.map((item) => item.provider)), new Set(["chatgpt", "gemini"]));
});

test("selected conversation jobs preserve only the chosen complete conversations", () => {
  const selection = createConversationSelectionSet({ title: "Batch", provider: "chatgpt", accountScopeId: "ws-1", refs });
  const job = createSelectedConversationJob(selection);
  assert.equal(job.scope, "selected-conversations");
  assert.equal(job.conversations.length, 2);
  assert.equal(job.sources.regular.pagination.indexingComplete, true);
  assert.equal(job.selection.fingerprint, selection.fingerprint);
});

test("selected export reuses durable history collection and resumes without indexing", async () => {
  const selection = createConversationSelectionSet({ title: "Batch", provider: "chatgpt", accountScopeId: "ws-1", refs });
  const store = memoryStore();
  const fetched = [];
  const job = await runSelectedConversationExport({
    selection,
    store,
    requestDelayMs: 0,
    transport: {
      async getContext() { return { provider: "chatgpt", workspaceId: "ws-1", workspaceLabel: "Workspace" }; },
      async fetchConversation(id) { fetched.push(id); return rawConversation(id, id); },
    },
  });
  assert.equal(job.status, "completed");
  assert.deepEqual(fetched.sort(), ["c-1", "c-2"]);
  assert.equal(job.completedIds.length, 2);
  const second = await runSelectedConversationExport({
    selection,
    store,
    requestDelayMs: 0,
    transport: {
      async getContext() { return { provider: "chatgpt", workspaceId: "ws-1", workspaceLabel: "Workspace" }; },
      async fetchConversation() { throw new Error("completed selection must not refetch"); },
    },
  });
  assert.equal(second.status, "completed");
});

test("selected export bounds timed-out conversations and continues the remaining batch", async () => {
  const selection = createConversationSelectionSet({ title: "Timeout batch", provider: "chatgpt", accountScopeId: "ws-1", refs });
  const store = memoryStore();
  const attempts = new Map();
  const job = await runSelectedConversationExport({
    selection,
    store,
    requestDelayMs: 0,
    maxConversationAttempts: 2,
    transport: {
      async getContext() { return { provider: "chatgpt", workspaceId: "ws-1", workspaceLabel: "Workspace" }; },
      async fetchConversation(id) {
        attempts.set(id, (attempts.get(id) ?? 0) + 1);
        if (id === "c-1") {
          const error = new Error("conversation timed out");
          error.status = 408;
          error.retryAfterMs = 1;
          throw error;
        }
        return rawConversation(id, id);
      },
    },
  });

  assert.equal(attempts.get("c-1"), 2);
  assert.equal(attempts.get("c-2"), 1);
  assert.equal(job.status, "completed_with_errors");
  assert.deepEqual(job.completedIds, ["c-2"]);
  assert.equal(job.failures.length, 1);
  assert.equal(job.failures[0].id, "c-1");
  assert.equal(job.failures[0].status, 408);
});

test("pause request stops timeout retries without recording a false failure", async () => {
  const selection = createConversationSelectionSet({ title: "Pause batch", provider: "chatgpt", accountScopeId: "ws-1", refs });
  const store = memoryStore();
  const control = { paused: false };
  let attempts = 0;
  const pausedJob = await runSelectedConversationExport({
    selection,
    store,
    control,
    requestDelayMs: 0,
    maxConversationAttempts: 2,
    transport: {
      async getContext() { return { provider: "chatgpt", workspaceId: "ws-1", workspaceLabel: "Workspace" }; },
      async fetchConversation() {
        attempts += 1;
        control.paused = true;
        const error = new Error("request timed out while pause was requested");
        error.status = 408;
        error.retryAfterMs = 1;
        throw error;
      },
    },
  });

  assert.equal(attempts, 1);
  assert.equal(pausedJob.status, "paused");
  assert.equal(pausedJob.failures.length, 0);
  assert.equal(pausedJob.completedIds.length, 0);

  control.paused = false;
  const resumedJob = await runSelectedConversationExport({
    selection,
    store,
    control,
    requestDelayMs: 0,
    maxConversationAttempts: 2,
    transport: {
      async getContext() { return { provider: "chatgpt", workspaceId: "ws-1", workspaceLabel: "Workspace" }; },
      async fetchConversation(id) { return rawConversation(id, id); },
    },
  });
  assert.equal(resumedJob.status, "completed");
  assert.equal(resumedJob.completedIds.length, 2);
});
