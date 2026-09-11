import { getProviderDefinition, providerSupports } from "./provider-registry.js";
import { normalizeConversationRef } from "./conversation-selection.js";

export function basketCollectionKey(provider, collectionId) {
  return `${String(provider || "generic-web-chat")}:${String(collectionId || "")}`;
}

export function buildBasketCatalog(records = []) {
  const conversations = new Map();
  const collections = new Map();
  const providerCounts = new Map();

  for (const record of records ?? []) {
    const source = record?.catalog;
    if (!source || !Array.isArray(source.conversations)) continue;
    const provider = String(record.provider || source.provider || "generic-web-chat");
    const accountScopeId = record.accountScopeId ?? source.accountScopeId ?? null;
    const definition = getProviderDefinition(provider);
    const providerLabel = definition.displayName;
    for (const item of source.conversations) {
      if (!item || typeof item !== "object") continue;
      try {
        const ref = normalizeConversationRef({ ...item, provider: item.provider || provider, accountScopeId: item.accountScopeId ?? accountScopeId });
        ref.provider = provider;
        ref.accountScopeId = item.accountScopeId ?? accountScopeId;
        ref.providerLabel = providerLabel;
        ref.collectionRefs = ref.collectionRefs.map((collection) => ({ ...collection, provider: collection.provider || provider }));
        conversations.set(ref.key, ref);
      } catch { /* invalid cached entries stay out of the presentation view */ }
    }
    for (const item of source.collections ?? []) {
      if (!item || typeof item !== "object") continue;
      const collectionId = String(item.collectionId ?? item.nativeId ?? "").trim();
      if (!collectionId) continue;
      const key = basketCollectionKey(provider, collectionId);
      collections.set(key, { key, provider, providerLabel, collectionId, title: String(item.title || "未命名空间") });
    }
  }

  const flattened = [...conversations.values()].sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0) || a.title.localeCompare(b.title));
  for (const ref of flattened) providerCounts.set(ref.provider, (providerCounts.get(ref.provider) ?? 0) + 1);
  for (const ref of flattened) {
    for (const item of ref.collectionRefs ?? []) {
      const provider = item.provider || ref.provider;
      const collectionId = String(item.collectionId || "").trim();
      if (!collectionId) continue;
      const key = basketCollectionKey(provider, collectionId);
      if (!collections.has(key)) collections.set(key, { key, provider, providerLabel: getProviderDefinition(provider).displayName, collectionId, title: item.title || "未命名空间" });
    }
  }
  return {
    conversations: flattened,
    providers: [...providerCounts].map(([id, count]) => ({ id, label: getProviderDefinition(id).displayName, count })),
    collections: [...collections.values()].sort((a, b) => a.providerLabel.localeCompare(b.providerLabel) || a.title.localeCompare(b.title)),
  };
}

export function captureEligibility(refs = []) {
  if (!refs.length) return { eligible: false, reason: "还没有选择会话。" };
  const providers = new Set(refs.map((ref) => ref?.provider).filter(Boolean));
  if (providers.size > 1) return { eligible: false, reason: "当前批次包含多个平台；请按平台分别采集。" };
  const provider = [...providers][0] || "generic-web-chat";
  if (providerSupports(provider, "batchSelection", ["verified"])) return { eligible: true, provider };
  return { eligible: false, reason: `${getProviderDefinition(provider).displayName} 暂不支持批量完整会话采集。` };
}
