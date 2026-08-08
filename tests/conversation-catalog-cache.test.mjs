import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryConversationCatalogStore } from "../apps/extension/src/conversation-catalog-store.js";

function catalog(scope, title) {
  return {
    provider: "chatgpt",
    accountScopeId: scope,
    accountScopeLabel: title,
    collections: [{ collectionId: `project-${scope}`, title: `${title} Project` }],
    conversations: [{ conversationId: `c-${scope}`, title: `${title} Conversation` }],
  };
}

test("conversation catalog cache persists catalogs per account scope", async () => {
  const store = createMemoryConversationCatalogStore();
  await store.put(catalog("personal", "Personal"));
  await new Promise((resolve) => setTimeout(resolve, 2));
  await store.put(catalog("team", "Team"));
  const personal = await store.get("chatgpt", "personal");
  const latest = await store.getLatest("chatgpt");
  assert.equal(personal.catalog.accountScopeLabel, "Personal");
  assert.equal(latest.catalog.accountScopeLabel, "Team");
  assert.equal(latest.conversationCount, 1);
});

test("conversation catalog cache returns defensive copies", async () => {
  const store = createMemoryConversationCatalogStore();
  await store.put(catalog("personal", "Personal"));
  const first = await store.get("chatgpt", "personal");
  first.catalog.conversations[0].title = "mutated";
  const second = await store.get("chatgpt", "personal");
  assert.equal(second.catalog.conversations[0].title, "Personal Conversation");
});
