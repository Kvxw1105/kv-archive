function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stableHash(value) {
  const source = typeof value === "string" ? value : JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function conversationRefKey(ref) {
  const provider = cleanText(ref?.provider) || "generic-web-chat";
  const scope = cleanText(ref?.accountScopeId) || "personal";
  const id = cleanText(ref?.conversationId ?? ref?.id);
  if (!id) throw new Error("Conversation reference is missing an ID");
  return `${provider}:${scope}:${id}`;
}

export function normalizeConversationRef(ref) {
  const key = conversationRefKey(ref);
  const provider = cleanText(ref.provider) || "generic-web-chat";
  const accountScopeId = cleanText(ref.accountScopeId) || null;
  const conversationId = cleanText(ref.conversationId ?? ref.id);
  return {
    key,
    provider,
    accountScopeId,
    conversationId,
    title: cleanText(ref.title) || "未命名对话",
    createdAt: ref.createdAt ?? ref.createTime ?? null,
    updatedAt: ref.updatedAt ?? ref.updateTime ?? null,
    url: cleanText(ref.url) || null,
    isArchived: Boolean(ref.isArchived),
    primaryCollectionId: cleanText(ref.primaryCollectionId ?? ref.projectId) || null,
    collectionRefs: Array.isArray(ref.collectionRefs) ? ref.collectionRefs.map((item) => ({ ...item })) : [],
    sourceMetadata: ref.sourceMetadata ?? ref,
  };
}

export function createConversationSelectionSet({ id = null, title = "会话选择集", provider = null, accountScopeId = null, refs = [], createdAt = new Date().toISOString() } = {}) {
  const byKey = new Map();
  for (const ref of refs) {
    const normalized = normalizeConversationRef({ ...ref, provider: ref?.provider ?? provider, accountScopeId: ref?.accountScopeId ?? accountScopeId });
    byKey.set(normalized.key, normalized);
  }
  const items = [...byKey.values()];
  const fingerprint = stableHash(items.map((item) => item.key).sort());
  return {
    version: 1,
    id: cleanText(id) || `selection-${fingerprint}`,
    title: cleanText(title) || "会话选择集",
    provider: cleanText(provider) || (items.length === 1 ? items[0].provider : null),
    accountScopeId: cleanText(accountScopeId) || (items.length === 1 ? items[0].accountScopeId : null),
    createdAt,
    updatedAt: createdAt,
    fingerprint,
    items,
  };
}

export function updateConversationSelectionSet(selection, refs) {
  const next = createConversationSelectionSet({
    id: selection?.id,
    title: selection?.title,
    provider: selection?.provider,
    accountScopeId: selection?.accountScopeId,
    refs,
    createdAt: selection?.createdAt ?? new Date().toISOString(),
  });
  next.updatedAt = new Date().toISOString();
  return next;
}

export function toggleConversationSelection(selection, ref, checked = null) {
  const normalized = normalizeConversationRef(ref);
  const current = new Map((selection?.items ?? []).map((item) => [conversationRefKey(item), normalizeConversationRef(item)]));
  const shouldAdd = checked === null ? !current.has(normalized.key) : Boolean(checked);
  if (shouldAdd) current.set(normalized.key, normalized);
  else current.delete(normalized.key);
  return updateConversationSelectionSet(selection ?? {}, [...current.values()]);
}

export function filterConversationRefs(refs, query, options = {}) {
  const needle = cleanText(query).toLocaleLowerCase();
  const provider = cleanText(options.provider);
  const collectionId = cleanText(options.collectionId);
  return (refs ?? []).map(normalizeConversationRef).filter((ref) => {
    if (provider && ref.provider !== provider) return false;
    if (collectionId && ref.primaryCollectionId !== collectionId && !ref.collectionRefs.some((item) => item.collectionId === collectionId)) return false;
    if (!needle) return true;
    const haystack = [ref.title, ref.provider, ref.primaryCollectionId, ...ref.collectionRefs.map((item) => item.title || item.collectionId)].join(" ").toLocaleLowerCase();
    return haystack.includes(needle);
  });
}

export function selectionJobId(selection) {
  if (!selection?.id) throw new Error("Selection set is missing an ID");
  return `conversation-selection:${selection.id}`;
}
