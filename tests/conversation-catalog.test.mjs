import test from "node:test";
import assert from "node:assert/strict";
import { loadChatGPTConversationCatalog } from "../apps/extension/dist/conversation-catalog.js";

test("conversation catalog merges regular archived and project membership into selectable refs", async () => {
  const transport = {
    async getContext() { return { workspaceId: "ws-1", workspaceLabel: "Workspace" }; },
    async listConversations({ archived }) {
      return archived
        ? { items: [{ id: "c-2", title: "Archived", isArchived: true }], total: 1 }
        : { items: [{ id: "c-1", title: "Regular" }], total: 1 };
    },
    async listProjects() { return { items: [{ id: "p-1", title: "Project", workspaceId: "ws-1", embeddedConversations: [], embeddedCursor: null }], cursor: null }; },
    async listProjectConversations() { return { items: [{ id: "c-1", title: "Regular", projectId: "p-1", projectTitle: "Project" }], cursor: null }; },
  };
  const catalog = await loadChatGPTConversationCatalog({ transport, pageSize: 100 });
  assert.equal(catalog.conversations.length, 2);
  const regular = catalog.conversations.find((item) => item.conversationId === "c-1");
  assert.equal(regular.primaryCollectionId, "p-1");
  assert.equal(regular.collectionRefs[0].title, "Project");
  assert.equal(catalog.collections.length, 1);
});
