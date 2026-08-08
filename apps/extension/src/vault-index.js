const encoder = new TextEncoder();

export function stableStringify(value) {
  const seen = new WeakSet();
  const normalize = (item) => {
    if (item === null || typeof item !== "object") return item;
    if (seen.has(item)) return "[Circular]";
    seen.add(item);
    if (Array.isArray(item)) return item.map(normalize);
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]));
  };
  return JSON.stringify(normalize(value));
}

export async function sha256Hex(value) {
  const bytes = value instanceof Uint8Array ? value : encoder.encode(typeof value === "string" ? value : stableStringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const INTERNAL_CONTEXT_PARTS = new Set(["tool_call", "tool_result", "reasoning_summary", "unknown"]);

export function contentPartText(part, options = {}) {
  if (!part || typeof part !== "object") return "";
  const includeInternal = Boolean(options.includeInternal);
  if (!includeInternal && INTERNAL_CONTEXT_PARTS.has(part.type)) return "";
  if (part.type === "text") return String(part.text || "");
  if (part.type === "code") return String(part.code || "");
  if (["image", "file", "citation", "canvas"].includes(part.type)) return String(part.text || "");
  return includeInternal ? String(part.text || "") : "";
}

export function tokenizeText(value) {
  const text = String(value || "").normalize("NFKC").toLowerCase();
  const tokens = new Set();
  for (const match of text.matchAll(/[a-z0-9][a-z0-9_+.-]{1,63}/g)) tokens.add(match[0]);
  const cjkRuns = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) || [];
  for (const run of cjkRuns) {
    const chars = [...run];
    for (const char of chars) tokens.add(char);
    for (let index = 0; index < chars.length - 1; index += 1) tokens.add(chars[index] + chars[index + 1]);
    for (let index = 0; index < chars.length - 2; index += 1) tokens.add(chars[index] + chars[index + 1] + chars[index + 2]);
  }
  return [...tokens].filter((token) => token.trim()).slice(0, 20_000);
}

function locationFromMetadata(metadata, canonical) {
  const locations = Array.isArray(metadata?.locations) ? metadata.locations : [];
  const project = locations.find((item) => item?.type === "project" && item.present !== false);
  const archived = locations.some((item) => item?.type === "archived" && item.present !== false) || Boolean(metadata?.archived);
  return {
    projectId: String(project?.projectId || canonical.projectId || "") || null,
    projectTitle: String(project?.projectTitle || metadata?.projectTitle || "") || null,
    archived,
  };
}

export async function buildVaultIndexBundle({ canonical, rawEvidence, source, sourceMetadata = null, importedAt = new Date().toISOString() }) {
  const conversationKey = `chatgpt:${canonical.conversationId}`;
  const evidenceHash = await sha256Hex({ canonical, rawEvidence });
  const evidenceKey = `${conversationKey}:${evidenceHash}`;
  const location = locationFromMetadata(sourceMetadata, canonical);
  const activePathSet = new Set(canonical.activePath || []);
  const messages = [];
  const postings = [];
  for (const node of Object.values(canonical.nodes || {})) {
    if (!node?.messageId && (!node?.content || node.content.length === 0)) continue;
    const text = (node.content || []).map(contentPartText).filter(Boolean).join("\n\n").trim();
    if (!text) continue;
    const messageKey = `${conversationKey}:${node.nodeId}`;
    const message = {
      key: messageKey,
      conversationKey,
      conversationId: canonical.conversationId,
      nodeId: node.nodeId,
      messageId: node.messageId,
      role: node.role || "unknown",
      text,
      normalizedText: `${canonical.title}\n${text}`.normalize("NFKC").toLowerCase(),
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      activePath: activePathSet.has(node.nodeId),
      projectId: location.projectId,
      projectTitle: location.projectTitle,
      archived: location.archived,
      sourceKind: source.kind,
      evidenceHash,
    };
    messages.push(message);
    for (const token of tokenizeText(`${canonical.title}\n${text}`)) {
      postings.push({ key: `${token}\u0000${messageKey}`, token, messageKey, conversationKey });
    }
  }
  const conversation = {
    key: conversationKey,
    conversationId: canonical.conversationId,
    title: canonical.title || "Untitled conversation",
    createdAt: canonical.createdAt,
    updatedAt: canonical.updatedAt,
    projectId: location.projectId,
    projectTitle: location.projectTitle,
    archived: location.archived,
    currentEvidenceHash: evidenceHash,
    currentEvidenceKey: evidenceKey,
    sourceKinds: [source.kind],
    sourceFiles: [source.fileName],
    messageCount: messages.length,
    activeMessageCount: messages.filter((item) => item.activePath).length,
    indexedAt: importedAt,
  };
  const evidence = {
    key: evidenceKey,
    conversationKey,
    conversationId: canonical.conversationId,
    evidenceHash,
    sourceKind: source.kind,
    sourceFileName: source.fileName,
    sourceFingerprint: source.fingerprint,
    importedAt,
    canonical,
    rawEvidence,
    sourceMetadata,
  };
  return { conversation, evidence, messages, postings };
}

export function scoreSearchResult(message, query) {
  const q = String(query || "").normalize("NFKC").toLowerCase().trim();
  if (!q) return 0;
  const text = message.normalizedText || String(message.text || "").toLowerCase();
  const tokens = tokenizeText(q);
  const matched = tokens.filter((token) => text.includes(token));
  if (!text.includes(q) && matched.length === 0) return 0;
  let score = text.includes(q) ? 100 : 0;
  for (const token of matched) score += Math.min(12, token.length * 3);
  if (message.activePath) score += 8;
  if (message.role === "user") score += 2;
  return score;
}
