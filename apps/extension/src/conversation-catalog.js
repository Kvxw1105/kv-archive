import { createConversationRef } from "./provider-registry.js";

function mergeRef(target, incoming) {
  if (!target) return incoming;
  const collections = new Map();
  for (const item of [...(target.collectionRefs ?? []), ...(incoming.collectionRefs ?? [])]) {
    collections.set(`${item.provider}:${item.collectionId}:${item.kind}`, item);
  }
  return {
    ...target,
    ...incoming,
    title: incoming.title || target.title,
    createdAt: target.createdAt ?? incoming.createdAt,
    updatedAt: incoming.updatedAt ?? target.updatedAt,
    isArchived: target.isArchived || incoming.isArchived,
    primaryCollectionId: incoming.primaryCollectionId ?? target.primaryCollectionId,
    collectionRefs: [...collections.values()],
  };
}

export async function loadChatGPTConversationCatalog({ transport, pageSize = 100, onProgress, maxPages = 1000 } = {}) {
  if (!transport) throw new Error("ChatGPT transport is required");
  const context = await transport.getContext();
  const byId = new Map();
  let pages = 0;

  for (const archived of [false, true]) {
    let offset = 0;
    while (pages < maxPages) {
      const response = await transport.listConversations({ offset, limit: pageSize, archived });
      pages += 1;
      for (const item of response.items ?? []) {
        const ref = createConversationRef(item, {
          provider: "chatgpt",
          accountScopeId: context.workspaceId,
          urlFactory: (id) => `https://chatgpt.com/c/${id}`,
        });
        byId.set(ref.conversationId, mergeRef(byId.get(ref.conversationId), ref));
      }
      onProgress?.({ phase: archived ? "archived" : "regular", count: byId.size, offset, pageItems: response.items?.length ?? 0 });
      const count = response.items?.length ?? 0;
      offset += count;
      if (count === 0 || count < pageSize || (Number.isFinite(response.total) && offset >= response.total)) break;
    }
  }

  let cursor = null;
  const projects = [];
  do {
    const response = await transport.listProjects({ cursor });
    pages += 1;
    projects.push(...(response.items ?? []));
    cursor = response.cursor ?? null;
    onProgress?.({ phase: "collections", count: byId.size, projects: projects.length });
  } while (cursor && pages < maxPages);

  for (const project of projects) {
    let projectCursor = project.embeddedCursor ?? "0";
    let embedded = project.embeddedConversations ?? [];
    let first = true;
    while (pages < maxPages) {
      let response;
      if (first && embedded.length) {
        response = { items: embedded, cursor: projectCursor };
      } else {
        response = await transport.listProjectConversations({ project, cursor: projectCursor ?? "0" });
      }
      pages += 1;
      for (const item of response.items ?? []) {
        const metadata = {
          ...item,
          projectId: project.id,
          projectTitle: project.title,
          workspaceId: project.workspaceId ?? context.workspaceId,
          collectionRefs: [{
            provider: "chatgpt",
            collectionId: project.id,
            kind: "project",
            title: project.title,
            nativeId: project.id,
          }],
        };
        const ref = createConversationRef(metadata, {
          provider: "chatgpt",
          accountScopeId: project.workspaceId ?? context.workspaceId,
          urlFactory: (id) => `https://chatgpt.com/c/${id}`,
        });
        byId.set(ref.conversationId, mergeRef(byId.get(ref.conversationId), ref));
      }
      onProgress?.({ phase: "collection-conversations", project, count: byId.size });
      first = false;
      projectCursor = response.cursor ?? null;
      if (!projectCursor) break;
    }
  }

  if (pages >= maxPages) throw new Error("会话目录超过安全页数，已停止读取");
  return {
    provider: "chatgpt",
    accountScopeId: context.workspaceId ?? null,
    accountScopeLabel: context.workspaceLabel ?? "个人空间",
    collections: projects.map((project) => ({
      provider: "chatgpt",
      collectionId: project.id,
      kind: "project",
      title: project.title,
      nativeId: project.id,
      metadata: { workspaceId: project.workspaceId ?? context.workspaceId ?? null },
    })),
    conversations: [...byId.values()].sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0) || a.title.localeCompare(b.title)),
  };
}
