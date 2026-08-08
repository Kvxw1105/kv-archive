import test from "node:test";
import assert from "node:assert/strict";
import {
  detectProviderFromUrl,
  getProviderDefinition,
  providerSupports,
  createConversationRef,
  isLikelyConversationUrl,
  isStructuredChatGPTConversationUrl,
} from "../apps/extension/dist/provider-registry.js";
import { mergeHydratedMessageBatches, normalizeVisibleConversationSnapshot } from "../apps/extension/dist/generic-dom-adapter.js";
import {
  CANONICAL_SCHEMA_VERSION,
  LEGACY_CANONICAL_SCHEMA_VERSION,
  upgradeCanonicalConversation,
  validateCanonicalConversation,
} from "../dist/packages/domain/src/index.js";

test("provider registry detects known AI platforms and keeps unknown pages generic", () => {
  assert.equal(detectProviderFromUrl("https://chatgpt.com/c/abc").id, "chatgpt");
  assert.equal(detectProviderFromUrl("https://gemini.google.com/app/abc").id, "gemini");
  assert.equal(detectProviderFromUrl("https://chat.deepseek.com/a/chat/s/abc").id, "deepseek");
  assert.equal(detectProviderFromUrl("https://example.com/chat").id, "generic-web-chat");
  assert.equal(providerSupports("chatgpt", "batchSelection"), true);
  assert.equal(getProviderDefinition("doubao").capabilities.currentStructured, "restricted-review");
  assert.equal(isLikelyConversationUrl("https://x.com/some-user/status/1"), false);
  assert.equal(isLikelyConversationUrl("https://x.com/i/grok"), true);
  assert.equal(isLikelyConversationUrl("https://gemini.google.com/app/abc"), true);
  assert.equal(isStructuredChatGPTConversationUrl("https://chatgpt.com/c/abc"), true);
  assert.equal(isStructuredChatGPTConversationUrl("https://chatgpt.com/g/g-p-project/c/abc"), true);
  assert.equal(isStructuredChatGPTConversationUrl("https://chatgpt.com/g/g-custom/c/abc?model=x"), true);
  assert.equal(isLikelyConversationUrl("https://chatgpt.com/g/g-p-project/c/abc"), true);
});

test("conversation references preserve provider account and collection identity", () => {
  const ref = createConversationRef({ id: "c-1", title: "Alpha", projectId: "p-1", projectTitle: "Project A", workspaceId: "ws-1" });
  assert.equal(ref.provider, "chatgpt");
  assert.equal(ref.accountScopeId, "ws-1");
  assert.equal(ref.primaryCollectionId, "p-1");
  assert.deepEqual(ref.collectionRefs.map((item) => item.collectionId), ["p-1"]);
});

test("generic visible capture creates a provider-neutral partial canonical graph", () => {
  const canonical = normalizeVisibleConversationSnapshot({
    title: "Gemini topic",
    url: "https://gemini.google.com/app/abc",
    capturedAt: "2026-07-28T00:00:00.000Z",
    messages: [
      { role: "user", text: "Question" },
      { role: "assistant", text: "Answer" },
    ],
  });
  assert.equal(canonical.schemaVersion, CANONICAL_SCHEMA_VERSION);
  assert.equal(canonical.source.provider, "gemini");
  assert.equal(canonical.source.captureMode, "visible-only");
  assert.equal(canonical.activePath.length, 2);
  assert.equal(validateCanonicalConversation(canonical).ok, true);
});

test("legacy canonical conversations upgrade without losing project compatibility", () => {
  const legacy = {
    schemaVersion: LEGACY_CANONICAL_SCHEMA_VERSION,
    conversationId: "legacy-1",
    title: "Legacy",
    source: { provider: "chatgpt", adapter: "legacy", sourceUrl: null },
    createdAt: null,
    updatedAt: null,
    currentNodeId: "n1",
    nodes: { n1: { nodeId: "n1", parentId: null, childrenIds: [], messageId: "m1", role: "user", createdAt: null, updatedAt: null, content: [], model: null, status: null, metadata: {}, rawPayload: null } },
    edges: [],
    activePath: ["n1"],
    projectId: "p-1",
    metadata: {},
    rawMetadata: {},
  };
  const upgraded = upgradeCanonicalConversation(legacy);
  assert.equal(upgraded.schemaVersion, CANONICAL_SCHEMA_VERSION);
  assert.equal(upgraded.primaryCollectionId, "p-1");
  assert.equal(upgraded.collectionRefs[0].collectionId, "p-1");
});


test("hydrated DOM batches accumulate older virtualized windows without losing repeated messages", () => {
  const make = (start, end) => Array.from({ length: end - start + 1 }, (_, offset) => {
    const index = start + offset;
    return {
      stableId: `turn-${index}`,
      role: index % 2 ? "user" : "assistant",
      text: index === 5 || index === 25 ? "重复但不同轮次" : `message ${index}`,
    };
  });
  const merged = mergeHydratedMessageBatches([
    make(31, 50),
    make(21, 40),
    make(11, 30),
    make(1, 20),
  ]);
  assert.equal(merged.length, 50);
  assert.equal(merged[0].stableId, "turn-1");
  assert.equal(merged.at(-1).stableId, "turn-50");
  assert.equal(merged.filter((item) => item.text === "重复但不同轮次").length, 2);
});
