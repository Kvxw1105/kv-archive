import test from "node:test";
import assert from "node:assert/strict";
import { buildBasketCatalog, captureEligibility } from "../apps/extension/src/conversation-catalog-view.js";

test("basket catalog keeps provider and collection identity across cached records", () => {
  const catalog = buildBasketCatalog([
    { provider: "chatgpt", accountScopeId: "personal", accountScopeLabel: "个人", catalog: {
      collections: [{ collectionId: "shared", title: "Shared" }],
      conversations: [{ conversationId: "c-1", title: "ChatGPT note", updatedAt: 2, collectionRefs: [{ collectionId: "shared", title: "Shared" }] }],
    } },
    { provider: "gemini", accountScopeId: "personal", accountScopeLabel: "个人", catalog: {
      collections: [{ collectionId: "shared", title: "Shared" }],
      conversations: [{ conversationId: "g-1", title: "Gemini note", updatedAt: 1, collectionRefs: [{ collectionId: "shared", title: "Shared" }] }],
    } },
  ]);
  assert.equal(catalog.conversations.length, 2);
  assert.deepEqual(catalog.providers.map((item) => [item.id, item.count]), [["chatgpt", 1], ["gemini", 1]]);
  assert.deepEqual(catalog.collections.map((item) => item.key).sort(), ["chatgpt:shared", "gemini:shared"]);
  assert.equal(catalog.conversations.find((item) => item.provider === "gemini").providerLabel, "Gemini");
});

test("capture eligibility only permits verified ChatGPT batches", () => {
  assert.deepEqual(captureEligibility([{ provider: "chatgpt" }]), { eligible: true, provider: "chatgpt" });
  assert.deepEqual(captureEligibility([{ provider: "gemini" }]), { eligible: false, reason: "Gemini 暂不支持批量完整会话采集。" });
  assert.deepEqual(captureEligibility([{ provider: "chatgpt" }, { provider: "gemini" }]), { eligible: false, reason: "当前批次包含多个平台；请按平台分别采集。" });
});
