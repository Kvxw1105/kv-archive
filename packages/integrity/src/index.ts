import type {
  CanonicalConversation,
  CanonicalMessageNode,
  CanonicalSemanticType,
} from "../../domain/src/index.js";

export type IntegrityStatus = "COMPLETE" | "PARTIAL" | "FAILED";

export interface IntegrityIssue {
  code: string;
  severity: "warning" | "error";
  nodeId: string | null;
  message: string;
}

export interface IntegrityReport {
  status: IntegrityStatus;
  conversationId: string;
  totalNodes: number;
  messageNodes: number;
  activePathMessages: number;
  branchNodes: number;
  unknownContentTypes: number;
  activeUnknownContentTypes: number;
  orphanNodes: number;
  orphanNodeIds: string[];
  userMessages: number;
  assistantFinalMessages: number;
  userVoiceTranscriptMessages: number;
  assistantVoiceTranscriptMessages: number;
  assistantIntermediateMessages: number;
  toolCalls: number;
  toolResults: number;
  reasoningMessages: number;
  filteredTechnicalNodes: number;
  unrecognizedActiveNodes: number;
  renderableConversationMessages: number;
  rootReached: boolean;
  parentBreaks: number;
  activePathContinuous: boolean;
  captureMode: string;
  sourceCompleteness: string;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  issues: IntegrityIssue[];
}

const semanticTypeOf = (node: CanonicalMessageNode): CanonicalSemanticType => {
  if (node.semanticType) return node.semanticType;
  if (node.role === "user") return "user";
  if (node.role === "tool") return "tool_result";
  if (node.role === "system") return "system";
  if (node.role === "assistant") {
    if (node.content.some((part) => part.type === "tool_call")) return "tool_call";
    if (node.content.some((part) => part.type === "tool_result")) return "tool_result";
    if (node.content.some((part) => part.type === "reasoning_summary")) return "reasoning";
    return "assistant_final";
  }
  return "unknown";
};

const hasReadablePart = (node: CanonicalMessageNode): boolean =>
  node.content.some((part) => {
    if (part.type === "text") return Boolean(part.text.trim());
    if (part.type === "code") return Boolean(part.code.trim());
    return ["image", "file", "citation", "canvas"].includes(part.type);
  });

const traceCurrentBranch = (conversation: CanonicalConversation): {
  graphPath: string[];
  rootReached: boolean;
  parentBreaks: number;
  cycleDetected: boolean;
} => {
  const graphPath: string[] = [];
  const visited = new Set<string>();
  let cursor = conversation.currentNodeId;
  let rootReached = false;
  let parentBreaks = 0;
  let cycleDetected = false;

  while (cursor) {
    if (visited.has(cursor)) {
      cycleDetected = true;
      break;
    }
    visited.add(cursor);
    const node = conversation.nodes[cursor];
    if (!node) {
      parentBreaks += 1;
      break;
    }
    graphPath.push(cursor);
    if (!node.parentId) {
      rootReached = true;
      break;
    }
    if (!conversation.nodes[node.parentId]) {
      parentBreaks += 1;
      break;
    }
    cursor = node.parentId;
  }

  return { graphPath: graphPath.reverse(), rootReached, parentBreaks, cycleDetected };
};

export function generateIntegrityReport(conversation: CanonicalConversation): IntegrityReport {
  const allNodes = Object.values(conversation.nodes);
  const nodeIds = new Set(Object.keys(conversation.nodes));
  const activeIds = new Set(conversation.activePath);
  const issues: IntegrityIssue[] = [];
  const orphanNodeIds: string[] = [];
  let unknownContentTypes = 0;
  let messageNodes = 0;

  for (const node of allNodes) {
    if (node.messageId || node.content.length > 0) messageNodes += 1;
    unknownContentTypes += node.content.filter((part) => part.type === "unknown").length;

    if (node.parentId && !nodeIds.has(node.parentId)) {
      orphanNodeIds.push(node.nodeId);
      issues.push({
        code: "MISSING_PARENT",
        severity: "error",
        nodeId: node.nodeId,
        message: `Parent ${node.parentId} does not exist`,
      });
    }
    for (const childId of node.childrenIds) {
      if (!nodeIds.has(childId)) {
        issues.push({
          code: "MISSING_CHILD",
          severity: "error",
          nodeId: node.nodeId,
          message: `Child ${childId} does not exist`,
        });
      }
    }
  }

  if (conversation.currentNodeId && !nodeIds.has(conversation.currentNodeId)) {
    issues.push({
      code: "MISSING_CURRENT_NODE",
      severity: "error",
      nodeId: conversation.currentNodeId,
      message: "Current node does not exist in the graph",
    });
  }
  if (conversation.activePath.length === 0) {
    issues.push({
      code: "EMPTY_ACTIVE_PATH",
      severity: "error",
      nodeId: conversation.currentNodeId,
      message: "No active message path could be reconstructed",
    });
  }

  const traced = traceCurrentBranch(conversation);
  if (!traced.rootReached && conversation.currentNodeId) {
    issues.push({
      code: traced.cycleDetected ? "PARENT_CYCLE" : "ROOT_NOT_REACHED",
      severity: "error",
      nodeId: conversation.currentNodeId,
      message: traced.cycleDetected
        ? "The current branch contains a parent cycle"
        : "The current branch could not be traced continuously to a root node",
    });
  }

  const expectedMessagePath = traced.graphPath.filter((nodeId) => {
    const node = conversation.nodes[nodeId];
    return Boolean(node && (node.messageId || node.content.length > 0));
  });
  const activePathContinuous =
    expectedMessagePath.length === conversation.activePath.length
    && expectedMessagePath.every((nodeId, index) => conversation.activePath[index] === nodeId);
  if (conversation.activePath.length > 0 && !activePathContinuous) {
    issues.push({
      code: "ACTIVE_PATH_MISMATCH",
      severity: "error",
      nodeId: conversation.currentNodeId,
      message: "The exported active path does not match the parent chain from the current node",
    });
  }

  const activeNodes = conversation.activePath
    .map((nodeId) => conversation.nodes[nodeId])
    .filter((node): node is CanonicalMessageNode => Boolean(node));
  const semanticCounts = new Map<CanonicalSemanticType, number>();
  for (const node of activeNodes) {
    const semantic = semanticTypeOf(node);
    semanticCounts.set(semantic, (semanticCounts.get(semantic) ?? 0) + 1);
  }

  const activeUnknownContentTypes = activeNodes.reduce(
    (count, node) => count + node.content.filter((part) => part.type === "unknown").length,
    0,
  );
  const userVoiceTranscriptMessages = semanticCounts.get("user_voice_transcript") ?? 0;
  const assistantVoiceTranscriptMessages = semanticCounts.get("assistant_voice_transcript") ?? 0;
  const userMessages = (semanticCounts.get("user") ?? 0) + userVoiceTranscriptMessages;
  const assistantFinalMessages = (semanticCounts.get("assistant_final") ?? 0) + assistantVoiceTranscriptMessages;
  const assistantIntermediateMessages = semanticCounts.get("assistant_intermediate") ?? 0;
  const toolCalls = semanticCounts.get("tool_call") ?? 0;
  const toolResults = semanticCounts.get("tool_result") ?? 0;
  const reasoningMessages = semanticCounts.get("reasoning") ?? 0;
  const unrecognizedActiveNodes = semanticCounts.get("unknown") ?? 0;
  const filteredTechnicalNodes = assistantIntermediateMessages + toolCalls + toolResults + reasoningMessages
    + (semanticCounts.get("system") ?? 0) + (semanticCounts.get("developer") ?? 0);
  const renderableConversationMessages = activeNodes.filter((node) => {
    const semantic = semanticTypeOf(node);
    return ["user", "user_voice_transcript", "assistant_final", "assistant_voice_transcript"].includes(semantic) && hasReadablePart(node);
  }).length;

  if (renderableConversationMessages === 0 && conversation.activePath.length > 0) {
    issues.push({
      code: "NO_RENDERABLE_CONVERSATION_MESSAGES",
      severity: "error",
      nodeId: conversation.currentNodeId,
      message: "The active branch contains no user-visible user or final-assistant messages",
    });
  }
  if (unrecognizedActiveNodes > 0) {
    issues.push({
      code: "UNRECOGNIZED_ACTIVE_EVENTS",
      severity: "error",
      nodeId: null,
      message: `${unrecognizedActiveNodes} active-path node(s) could not be classified semantically`,
    });
  }
  if (unknownContentTypes > 0) {
    issues.push({
      code: "UNKNOWN_CONTENT_PRESERVED",
      severity: activeUnknownContentTypes > 0 ? "error" : "warning",
      nodeId: null,
      message: activeUnknownContentTypes > 0
        ? `${activeUnknownContentTypes} active-branch content part(s) could not be parsed; raw payloads were preserved`
        : `${unknownContentTypes} unknown branch content part(s) were preserved as raw payloads`,
    });
  }

  const sourceCompleteness = conversation.source.completeness ?? "unknown";
  if (sourceCompleteness !== "verified") {
    issues.push({
      code: "SOURCE_COMPLETENESS_UNVERIFIED",
      severity: "warning",
      nodeId: null,
      message: `Capture source completeness is ${sourceCompleteness}; the export cannot be labelled verified complete`,
    });
  }

  const timestamps = activeNodes
    .flatMap((node) => [node.createdAt, node.updatedAt])
    .filter((value): value is string => Boolean(value))
    .sort();

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const hardFailure = Object.keys(conversation.nodes).length === 0 || conversation.activePath.length === 0;
  const status: IntegrityStatus = hardFailure
    ? "FAILED"
    : errors > 0 || sourceCompleteness !== "verified"
      ? "PARTIAL"
      : "COMPLETE";

  return {
    status,
    conversationId: conversation.conversationId,
    totalNodes: allNodes.length,
    messageNodes,
    activePathMessages: conversation.activePath.length,
    branchNodes: allNodes.filter((node) => !activeIds.has(node.nodeId) && (node.messageId || node.content.length > 0)).length,
    unknownContentTypes,
    activeUnknownContentTypes,
    orphanNodes: orphanNodeIds.length,
    orphanNodeIds: orphanNodeIds.sort(),
    userMessages,
    assistantFinalMessages,
    userVoiceTranscriptMessages,
    assistantVoiceTranscriptMessages,
    assistantIntermediateMessages,
    toolCalls,
    toolResults,
    reasoningMessages,
    filteredTechnicalNodes,
    unrecognizedActiveNodes,
    renderableConversationMessages,
    rootReached: traced.rootReached,
    parentBreaks: traced.parentBreaks,
    activePathContinuous,
    captureMode: conversation.source.captureMode ?? "unknown",
    sourceCompleteness,
    firstMessageAt: timestamps[0] ?? null,
    lastMessageAt: timestamps.at(-1) ?? null,
    issues,
  };
}
