const PROVIDERS = Object.freeze([
  {
    id: "chatgpt",
    displayName: "ChatGPT",
    domains: ["chatgpt.com", "chat.openai.com"],
    capabilities: {
      currentVisible: "verified",
      currentStructured: "verified",
      fullHistory: "verified",
      collections: "verified",
      attachments: "partial",
      branches: "verified",
      batchSelection: "verified",
      officialImport: "verified",
    },
  },
  {
    id: "gemini",
    displayName: "Gemini",
    domains: ["gemini.google.com"],
    capabilities: {
      currentVisible: "experimental",
      currentStructured: "planned",
      fullHistory: "official-import-planned",
      collections: "planned",
      attachments: "visible-only",
      branches: "unknown",
      batchSelection: "planned",
      officialImport: "planned",
    },
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    domains: ["chat.deepseek.com", "deepseek.com"],
    capabilities: {
      currentVisible: "experimental",
      currentStructured: "planned",
      fullHistory: "official-import-planned",
      collections: "unsupported",
      attachments: "visible-only",
      branches: "unknown",
      batchSelection: "planned",
      officialImport: "planned",
    },
  },
  {
    id: "grok",
    displayName: "Grok",
    domains: ["grok.com", "x.com"],
    capabilities: {
      currentVisible: "experimental",
      currentStructured: "planned",
      fullHistory: "unknown",
      collections: "unknown",
      attachments: "visible-only",
      branches: "unknown",
      batchSelection: "planned",
      officialImport: "unknown",
    },
  },
  {
    id: "qwen",
    displayName: "千问",
    domains: ["chat.qwen.ai", "qianwen.com"],
    capabilities: {
      currentVisible: "experimental",
      currentStructured: "planned",
      fullHistory: "unknown",
      collections: "unknown",
      attachments: "visible-only",
      branches: "unknown",
      batchSelection: "planned",
      officialImport: "unknown",
    },
  },
  {
    id: "doubao",
    displayName: "豆包",
    domains: ["doubao.com"],
    capabilities: {
      currentVisible: "experimental",
      currentStructured: "restricted-review",
      fullHistory: "unsupported",
      collections: "unknown",
      attachments: "visible-only",
      branches: "unknown",
      batchSelection: "visible-only",
      officialImport: "unknown",
    },
  },
  {
    id: "zhipu",
    displayName: "智谱清言",
    domains: ["chatglm.cn"],
    capabilities: {
      currentVisible: "experimental",
      currentStructured: "planned",
      fullHistory: "unknown",
      collections: "planned",
      attachments: "visible-only",
      branches: "unknown",
      batchSelection: "planned",
      officialImport: "unknown",
    },
  },
  {
    id: "zai",
    displayName: "Z.ai",
    domains: ["chat.z.ai", "z.ai"],
    capabilities: {
      currentVisible: "experimental",
      currentStructured: "planned",
      fullHistory: "unknown",
      collections: "planned",
      attachments: "visible-only",
      branches: "unknown",
      batchSelection: "planned",
      officialImport: "unknown",
    },
  },
  {
    id: "claude",
    displayName: "Claude",
    domains: ["claude.ai"],
    capabilities: {
      currentVisible: "experimental",
      currentStructured: "planned",
      fullHistory: "unknown",
      collections: "planned",
      attachments: "visible-only",
      branches: "unknown",
      batchSelection: "planned",
      officialImport: "unknown",
    },
  },
  {
    id: "perplexity",
    displayName: "Perplexity",
    domains: ["perplexity.ai"],
    capabilities: {
      currentVisible: "experimental",
      currentStructured: "planned",
      fullHistory: "unknown",
      collections: "planned",
      attachments: "visible-only",
      branches: "unknown",
      batchSelection: "planned",
      officialImport: "unknown",
    },
  },
]);

const GENERIC_PROVIDER = Object.freeze({
  id: "generic-web-chat",
  displayName: "通用 AI 网页",
  domains: [],
  capabilities: Object.freeze({
    currentVisible: "visible-only",
    currentStructured: "unsupported",
    fullHistory: "unsupported",
    collections: "unsupported",
    attachments: "visible-only",
    branches: "unsupported",
    batchSelection: "visible-only",
    officialImport: "unsupported",
  }),
});

function normalizeHostname(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

export function listProviderDefinitions() {
  return [...PROVIDERS, GENERIC_PROVIDER].map((provider) => ({
    ...provider,
    domains: [...provider.domains],
    capabilities: { ...provider.capabilities },
  }));
}

export function getProviderDefinition(providerId) {
  return PROVIDERS.find((provider) => provider.id === providerId) ?? GENERIC_PROVIDER;
}

export function detectProviderFromUrl(url) {
  const hostname = normalizeHostname(url);
  if (!hostname) return GENERIC_PROVIDER;
  for (const provider of PROVIDERS) {
    if (provider.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) return provider;
  }
  return GENERIC_PROVIDER;
}


export function isStructuredChatGPTConversationUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (detectProviderFromUrl(url).id !== "chatgpt") return false;
  return /(?:^|\/)c\/[^/?#]+(?:$|\/)/.test(parsed.pathname || "/");
}

export function isLikelyConversationUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname || "/";
  const provider = detectProviderFromUrl(url);
  if (provider.id === "generic-web-chat") return false;
  if (provider.id === "chatgpt") return isStructuredChatGPTConversationUrl(url);
  if (provider.id === "gemini") return /^\/app(?:\/|$)/.test(path);
  if (provider.id === "deepseek") return hostname === "chat.deepseek.com" || /^\/(?:a\/)?chat(?:\/|$)/.test(path);
  if (provider.id === "grok") return hostname === "grok.com" || /^\/i\/grok(?:\/|$)/.test(path);
  if (provider.id === "qwen") return hostname === "chat.qwen.ai" || /^\/chat(?:\/|$)/.test(path);
  if (provider.id === "doubao") return /^\/chat(?:\/|$)/.test(path);
  if (provider.id === "zai") return hostname === "chat.z.ai" || /^\/chat(?:\/|$)/.test(path);
  if (provider.id === "claude") return /^\/chat(?:\/|$)/.test(path);
  if (provider.id === "perplexity") return /^\/(?:search|page)(?:\/|$)/.test(path) || Boolean(parsed.searchParams.get("q"));
  return true;
}

export function providerSupports(providerId, capability, accepted = ["verified", "experimental", "visible-only"]) {
  const value = getProviderDefinition(providerId).capabilities?.[capability] ?? "unsupported";
  return accepted.includes(value);
}

export function createConversationRef(metadata, options = {}) {
  if (!metadata || typeof metadata !== "object") throw new Error("Conversation metadata is required");
  const conversationId = String(metadata.id ?? metadata.conversationId ?? "").trim();
  if (!conversationId) throw new Error("Conversation reference is missing an ID");
  const provider = options.provider ?? metadata.provider ?? "chatgpt";
  const accountScopeId = options.accountScopeId ?? metadata.workspaceId ?? null;
  const projectId = metadata.projectId ?? null;
  const collectionRefs = Array.isArray(metadata.collectionRefs)
    ? metadata.collectionRefs
    : projectId
      ? [{ provider, collectionId: String(projectId), kind: "project", title: metadata.projectTitle ?? null, nativeId: String(projectId) }]
      : [];
  return {
    provider,
    accountScopeId: accountScopeId ? String(accountScopeId) : null,
    conversationId,
    title: String(metadata.title || "未命名对话"),
    createdAt: metadata.createTime ?? metadata.createdAt ?? null,
    updatedAt: metadata.updateTime ?? metadata.updatedAt ?? null,
    url: metadata.url ?? options.urlFactory?.(conversationId) ?? null,
    isArchived: Boolean(metadata.isArchived),
    primaryCollectionId: projectId ? String(projectId) : null,
    collectionRefs: collectionRefs.map((item) => ({
      provider: item.provider ?? provider,
      collectionId: String(item.collectionId ?? item.nativeId ?? ""),
      kind: String(item.kind ?? "collection"),
      title: item.title ? String(item.title) : null,
      nativeId: item.nativeId ? String(item.nativeId) : null,
    })).filter((item) => item.collectionId),
    sourceMetadata: metadata,
  };
}

export function providerCapabilitySummary(providerId) {
  const provider = getProviderDefinition(providerId);
  return {
    provider: provider.id,
    displayName: provider.displayName,
    ...provider.capabilities,
  };
}
