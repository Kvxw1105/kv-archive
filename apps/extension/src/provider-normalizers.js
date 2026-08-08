import { normalizeChatGPTConversation } from "./packages/normalizer/src/index.js";
import { normalizeVisibleConversationSnapshot } from "./generic-dom-adapter.js";

export function normalizeProviderConversation(raw, options = {}) {
  const provider = options.provider ?? raw?.provider ?? "chatgpt";
  if (provider === "chatgpt" || raw?.mapping) {
    return normalizeChatGPTConversation(raw, {
      provider,
      adapter: options.adapter ?? "provider-structured",
      sourceUrl: options.sourceUrl ?? null,
      captureMode: options.captureMode ?? "structured",
      completeness: options.completeness ?? "verified",
      primaryCollectionId: options.primaryCollectionId ?? null,
      collectionRefs: options.collectionRefs ?? [],
    });
  }
  if (Array.isArray(raw?.messages)) {
    return normalizeVisibleConversationSnapshot(raw, {
      provider,
      adapter: options.adapter ?? "generic-dom-visible",
      sourceUrl: options.sourceUrl ?? raw.url ?? null,
    });
  }
  throw new Error(`No normalizer is registered for provider: ${provider}`);
}
