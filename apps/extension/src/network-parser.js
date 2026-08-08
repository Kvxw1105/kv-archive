export function decodeResponseBody(result) {
  if (!result?.base64Encoded) return result?.body || "";
  const binary = atob(result.body || "");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const cleanString = (value) => typeof value === "string" && value.trim() ? value.trim() : null;

export function collectConversationObjects(value, visited = new Set(), output = []) {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || (!text.startsWith("{") && !text.startsWith("["))) return output;
    try { return collectConversationObjects(JSON.parse(text), visited, output); } catch { return output; }
  }
  if (!value || typeof value !== "object" || visited.has(value)) return output;
  visited.add(value);
  if (isRecord(value.mapping) && cleanString(value.current_node)) output.push(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    collectConversationObjects(child, visited, output);
  }
  return output;
}

export function findConversationObject(value, visited = new Set()) {
  return collectConversationObjects(value, visited, [])[0] ?? null;
}

function conversationId(value) {
  return cleanString(value?.id) || cleanString(value?.conversation_id) || cleanString(value?.conversationId);
}

function traceRawCurrentBranch(conversation) {
  const mapping = isRecord(conversation?.mapping) ? conversation.mapping : {};
  const visited = new Set();
  const graphPath = [];
  let cursor = cleanString(conversation?.current_node);
  let rootReached = false;
  let parentBreaks = 0;
  let cycleDetected = false;

  while (cursor) {
    if (visited.has(cursor)) {
      cycleDetected = true;
      break;
    }
    visited.add(cursor);
    const node = mapping[cursor];
    if (!isRecord(node)) {
      parentBreaks += 1;
      break;
    }
    graphPath.push(cursor);
    const parent = cleanString(node.parent);
    if (!parent) {
      rootReached = true;
      break;
    }
    if (!isRecord(mapping[parent])) {
      parentBreaks += 1;
      break;
    }
    cursor = parent;
  }

  const messagePath = graphPath.reverse().filter((nodeId) => isRecord(mapping[nodeId]?.message));
  return { messagePath, rootReached, parentBreaks, cycleDetected };
}

export function analyzeConversationCandidate(conversation, options = {}) {
  const mapping = isRecord(conversation?.mapping) ? conversation.mapping : {};
  const expectedId = cleanString(options.expectedId);
  const capturedId = conversationId(conversation);
  const exactId = !expectedId || capturedId === expectedId;
  const trace = traceRawCurrentBranch(conversation);
  let messageNodeCount = 0;
  let userMessages = 0;
  let assistantMessages = 0;

  for (const node of Object.values(mapping)) {
    const message = isRecord(node?.message) ? node.message : null;
    if (!message) continue;
    messageNodeCount += 1;
    const role = cleanString(message.author?.role)?.toLowerCase();
    if (role === "user") userMessages += 1;
    if (role === "assistant") assistantMessages += 1;
  }

  const responseUrl = String(options.responseUrl || "");
  const directConversationEndpoint = Boolean(
    capturedId && new RegExp(`/backend-api/conversation/${capturedId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[/?#]|$)`).test(responseUrl),
  );
  const viable = Boolean(capturedId && Object.keys(mapping).length && cleanString(conversation?.current_node));
  const score =
    (viable ? 1_000_000 : 0)
    + (exactId ? 200_000 : -1_000_000)
    + (directConversationEndpoint ? 100_000 : 0)
    + (trace.rootReached ? 50_000 : 0)
    - (trace.parentBreaks * 25_000)
    - (trace.cycleDetected ? 50_000 : 0)
    + (trace.messagePath.length * 1_000)
    + (messageNodeCount * 10)
    + userMessages
    + assistantMessages;

  const currentNodeId = cleanString(conversation?.current_node);
  const currentNode = currentNodeId && isRecord(mapping[currentNodeId]) ? mapping[currentNodeId] : null;
  const currentMessage = currentNode && isRecord(currentNode.message) ? currentNode.message : null;
  const currentMessageId = cleanString(currentMessage?.id);

  return {
    conversation,
    capturedId,
    exactId,
    viable,
    score,
    responseUrl,
    directConversationEndpoint,
    nodeCount: Object.keys(mapping).length,
    messageNodeCount,
    activePathMessages: trace.messagePath.length,
    rootReached: trace.rootReached,
    parentBreaks: trace.parentBreaks,
    cycleDetected: trace.cycleDetected,
    userMessages,
    assistantMessages,
    currentNodeId,
    currentMessageId,
  };
}

const looksLikeStableMessageId = (value) => typeof value === "string" && (
  /^[a-f0-9]{8}-[a-f0-9-]{20,}$/i.test(value)
  || /^msg[-_:][a-z0-9-]{8,}$/i.test(value)
);

export function assessStructuredCaptureConfidence(candidate, pageDiagnostics = {}, options = {}) {
  const reasons = [];
  const smallBranchThreshold = Math.max(2, Number(options.smallBranchThreshold ?? 12));
  const visibleMessages = Number(pageDiagnostics?.initialVisibleMessages ?? 0) || 0;
  const maxTurnOrdinal = Number(pageDiagnostics?.maxStableTurnOrdinal);
  const pageLowerBound = Math.max(
    visibleMessages,
    Number.isFinite(maxTurnOrdinal) ? maxTurnOrdinal : 0,
  );

  if (!candidate?.viable) reasons.push("NOT_VIABLE");
  if (!candidate?.exactId) reasons.push("CONVERSATION_ID_MISMATCH");
  if (!candidate?.rootReached) reasons.push("ROOT_NOT_REACHED");
  if ((candidate?.parentBreaks ?? 0) > 0) reasons.push("PARENT_BREAK");
  if (candidate?.cycleDetected) reasons.push("PARENT_CYCLE");
  if ((candidate?.activePathMessages ?? 0) < visibleMessages) reasons.push("FEWER_THAN_VISIBLE_MESSAGES");
  if (Number.isFinite(maxTurnOrdinal) && maxTurnOrdinal > 0 && (candidate?.activePathMessages ?? 0) < maxTurnOrdinal) {
    reasons.push("BELOW_PAGE_TURN_LOWER_BOUND");
  }

  const pageLastStableId = cleanString(pageDiagnostics?.lastStableId);
  const structuredCurrentIds = [candidate?.currentMessageId, candidate?.currentNodeId].filter(looksLikeStableMessageId);
  if (looksLikeStableMessageId(pageLastStableId) && structuredCurrentIds.length > 0 && !structuredCurrentIds.includes(pageLastStableId)) {
    reasons.push("CURRENT_LEAF_MISMATCH");
  }

  const structurallyContinuous = !reasons.some((reason) => [
    "NOT_VIABLE",
    "CONVERSATION_ID_MISMATCH",
    "ROOT_NOT_REACHED",
    "PARENT_BREAK",
    "PARENT_CYCLE",
  ].includes(reason));
  const needsHydration = !structurallyContinuous
    || reasons.length > 0
    || (candidate?.activePathMessages ?? 0) <= smallBranchThreshold;
  if (structurallyContinuous && (candidate?.activePathMessages ?? 0) <= smallBranchThreshold) {
    reasons.push("SMALL_BRANCH_REQUIRES_CORROBORATION");
  }

  return {
    confident: structurallyContinuous && reasons.length === 0,
    structurallyContinuous,
    needsHydration,
    reasons: [...new Set(reasons)],
    pageLowerBound,
    visibleMessages,
    maxTurnOrdinal: Number.isFinite(maxTurnOrdinal) ? maxTurnOrdinal : null,
    smallBranchThreshold,
  };
}

export function hydrationCorroboratesStructuredCapture(candidate, hydrationDiagnostics = {}, accumulatedMessages = 0) {
  if (!candidate?.viable || !candidate?.exactId || !candidate?.rootReached || candidate.parentBreaks > 0 || candidate.cycleDetected) return false;
  if (!hydrationDiagnostics?.hydrationComplete) return false;
  const visibleCount = Math.max(0, Number(accumulatedMessages) || 0);
  const maxTurnOrdinal = Number(hydrationDiagnostics?.maxStableTurnOrdinal);
  if ((candidate.activePathMessages ?? 0) < visibleCount) return false;
  if (Number.isFinite(maxTurnOrdinal) && maxTurnOrdinal > 0 && (candidate.activePathMessages ?? 0) < maxTurnOrdinal) return false;
  return true;
}

export function chooseBestConversationCandidate(candidates, options = {}) {
  return (candidates || [])
    .map((entry) => entry?.conversation ? entry : analyzeConversationCandidate(entry, options))
    .filter((entry) => entry.viable && entry.exactId)
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

export function parseConversationCandidates(body, options = {}) {
  const parsedObjects = [];
  const rawCandidates = [body];
  for (const line of String(body || "").split(/\r?\n/)) {
    const cleaned = line.replace(/^data:\s*/, "").replace(/^\s*[0-9a-f]+:[A-Z]?\s*/i, "").trim();
    if (!cleaned || cleaned === "[DONE]") continue;
    rawCandidates.push(cleaned);
    const starts = [cleaned.indexOf("{"), cleaned.indexOf("[")].filter((index) => index >= 0);
    if (starts.length) rawCandidates.push(cleaned.slice(Math.min(...starts)));
  }

  for (const candidate of rawCandidates) {
    try {
      const value = typeof candidate === "string" ? JSON.parse(candidate) : candidate;
      parsedObjects.push(...collectConversationObjects(value));
    } catch {}
  }

  const seen = new Set();
  return parsedObjects
    .filter((conversation) => {
      const key = `${conversationId(conversation) || "unknown"}:${cleanString(conversation.current_node) || "none"}:${Object.keys(conversation.mapping || {}).length}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((conversation) => analyzeConversationCandidate(conversation, options));
}

export function parseConversationResponse(body, options = {}) {
  return chooseBestConversationCandidate(parseConversationCandidates(body, options), options)?.conversation ?? null;
}

export function conversationIdFromUrl(url) {
  return url?.match(/\/c\/([^/?#]+)/)?.[1] || null;
}
