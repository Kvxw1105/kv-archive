import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalContentPart,
  type CanonicalConversation,
  type CanonicalMessageNode,
  type CanonicalRole,
  type CanonicalSemanticType,
} from "../../domain/src/index.js";

interface NormalizeOptions {
  adapter?: string;
  sourceUrl?: string | null;
  provider?: string;
  captureMode?: "structured" | "visible-only" | "official-import" | "unknown";
  completeness?: "verified" | "partial" | "visible-only" | "unknown";
  primaryCollectionId?: string | null;
  collectionRefs?: CanonicalConversation["collectionRefs"];
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const firstString = (record: UnknownRecord | null, keys: string[]): string | null => {
  if (!record) return null;
  for (const key of keys) {
    const value = asString(record[key]);
    if (value?.trim()) return value.trim();
  }
  return null;
};

const timestampToIso = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }
  return null;
};

const normalizeRole = (value: unknown): CanonicalRole => {
  if (value === "user" || value === "assistant" || value === "system" || value === "tool") {
    return value;
  }
  if (value === "developer") return "system";
  return "unknown";
};

const normalizeToken = (value: string | null): string => (value ?? "").trim().toLowerCase();

const VOICE_SIGNAL = /voice|audio|realtime|speech|transcript|transcription|spoken|microphone|camera/i;

interface VoiceTranscriptInfo {
  isVoiceTranscript: boolean;
  texts: string[];
  sourceFields: string[];
}

const cleanTranscriptText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\u00a0/g, " ").trim();
  return cleaned || null;
};

const collectTranscriptStrings = (value: unknown, depth = 0): string[] => {
  if (depth > 4 || value == null) return [];
  const direct = cleanTranscriptText(value);
  if (direct) return [direct];
  if (Array.isArray(value)) return value.flatMap((entry) => collectTranscriptStrings(entry, depth + 1));
  if (!isRecord(value)) return [];

  const preferredKeys = [
    "transcript",
    "transcription",
    "audio_transcript",
    "audioTranscript",
    "voice_transcript",
    "voiceTranscript",
    "spoken_text",
    "spokenText",
    "caption",
    "text",
    "value",
  ];
  const collected: string[] = [];
  for (const key of preferredKeys) {
    if (key in value) collected.push(...collectTranscriptStrings(value[key], depth + 1));
  }
  return collected;
};

const recordHasVoiceFlag = (record: UnknownRecord | null): boolean => {
  if (!record) return false;
  const booleanKeys = [
    "is_voice",
    "isVoice",
    "voice_mode",
    "voiceMode",
    "is_audio",
    "isAudio",
    "realtime",
    "is_realtime",
    "isRealtime",
  ];
  if (booleanKeys.some((key) => record[key] === true)) return true;
  return Object.entries(record).some(([key, value]) => {
    if (!VOICE_SIGNAL.test(key)) return false;
    return value === true || (typeof value === "string" && VOICE_SIGNAL.test(value));
  });
};

const voiceTranscriptInfo = (
  rawMessage: UnknownRecord | null,
  content: UnknownRecord | null,
  metadata: UnknownRecord,
): VoiceTranscriptInfo => {
  if (!rawMessage) return { isVoiceTranscript: false, texts: [], sourceFields: [] };

  const sourceCandidates: Array<[string, unknown]> = [
    ["message.transcript", rawMessage.transcript],
    ["message.transcription", rawMessage.transcription],
    ["message.audio_transcript", rawMessage.audio_transcript],
    ["message.audioTranscript", rawMessage.audioTranscript],
    ["message.voice_transcript", rawMessage.voice_transcript],
    ["message.voiceTranscript", rawMessage.voiceTranscript],
    ["content.transcript", content?.transcript],
    ["content.transcription", content?.transcription],
    ["content.audio_transcript", content?.audio_transcript],
    ["content.audioTranscript", content?.audioTranscript],
    ["content.voice_transcript", content?.voice_transcript],
    ["content.voiceTranscript", content?.voiceTranscript],
    ["metadata.transcript", metadata.transcript],
    ["metadata.transcription", metadata.transcription],
    ["metadata.audio_transcript", metadata.audio_transcript],
    ["metadata.audioTranscript", metadata.audioTranscript],
    ["metadata.voice_transcript", metadata.voice_transcript],
    ["metadata.voiceTranscript", metadata.voiceTranscript],
  ];

  const signalTokens = [
    firstString(content, ["content_type", "contentType", "type"]),
    firstString(rawMessage, ["type", "message_type", "messageType", "event_type", "eventType"]),
    firstString(metadata, ["message_type", "messageType", "event_type", "eventType", "modality", "input_modality", "output_modality"]),
  ].filter((value): value is string => Boolean(value));

  const parts = Array.isArray(content?.parts) ? content.parts : [];
  for (const [index, part] of parts.entries()) {
    if (!isRecord(part)) continue;
    const partType = firstString(part, ["content_type", "contentType", "type", "modality"]);
    const explicitTranscript = [
      part.transcript,
      part.transcription,
      part.audio_transcript,
      part.audioTranscript,
      part.voice_transcript,
      part.voiceTranscript,
      part.spoken_text,
      part.spokenText,
      part.caption,
    ].some((value) => collectTranscriptStrings(value).length > 0);
    if ((partType && VOICE_SIGNAL.test(partType)) || explicitTranscript) {
      sourceCandidates.push([`content.parts[${index}]`, part]);
      if (partType) signalTokens.push(partType);
    }
  }

  const explicitSources = sourceCandidates
    .map(([field, value]) => [field, collectTranscriptStrings(value)] as const)
    .filter(([, values]) => values.length > 0);
  const hasVoiceSignal = signalTokens.some((value) => VOICE_SIGNAL.test(value))
    || recordHasVoiceFlag(rawMessage)
    || recordHasVoiceFlag(content)
    || recordHasVoiceFlag(metadata);

  if (hasVoiceSignal && parts.length > 0) {
    const stringParts = parts.flatMap((part) => typeof part === "string" ? [part] : []);
    if (stringParts.length > 0) sourceCandidates.push(["content.parts", stringParts]);
  }

  const allSources = sourceCandidates
    .map(([field, value]) => [field, collectTranscriptStrings(value)] as const)
    .filter(([, values]) => values.length > 0);
  const texts = [...new Set(allSources.flatMap(([, values]) => values))];
  const sourceFields = [...new Set(allSources.map(([field]) => field))];
  const isVoiceTranscript = texts.length > 0 && (hasVoiceSignal || explicitSources.length > 0);
  return { isVoiceTranscript, texts: isVoiceTranscript ? texts : [], sourceFields };
};

const semanticTypeForMessage = (
  rawMessage: UnknownRecord | null,
  author: UnknownRecord | null,
  metadata: UnknownRecord,
): CanonicalSemanticType => {
  if (!rawMessage) return "unknown";
  const rawRole = normalizeToken(asString(author?.role));
  const content = isRecord(rawMessage.content) ? rawMessage.content : null;
  const contentType = normalizeToken(firstString(content, ["content_type", "contentType", "type"]));
  const recipient = normalizeToken(
    firstString(rawMessage, ["recipient", "target", "to"])
      ?? firstString(metadata, ["recipient", "target", "to"]),
  );
  const channel = normalizeToken(
    firstString(rawMessage, ["channel", "message_channel"])
      ?? firstString(metadata, ["channel", "message_channel", "messageChannel"]),
  );
  const authorName = normalizeToken(firstString(author, ["name"]));
  const status = normalizeToken(firstString(rawMessage, ["status"]));
  const messageType = normalizeToken(firstString(metadata, ["message_type", "messageType", "event_type", "eventType"]));

  if (rawRole === "developer") return "developer";
  if (rawRole === "system") return "system";
  if (rawRole === "tool") return "tool_result";

  const toolResultTypes = new Set([
    "tool_result",
    "tool_output",
    "computer_output",
    "execution_output",
    "code_execution_output",
  ]);
  const toolCallTypes = new Set([
    "tool_call",
    "tool_use",
    "computer_initialize_state",
    "computer_input",
    "code_execution",
  ]);
  const reasoningTypes = new Set([
    "reasoning",
    "reasoning_summary",
    "thoughts",
    "analysis",
  ]);

  if (toolResultTypes.has(contentType)) return "tool_result";
  if (toolCallTypes.has(contentType)) return "tool_call";
  if (reasoningTypes.has(contentType) || channel === "analysis") return "reasoning";

  const voice = voiceTranscriptInfo(rawMessage, content, metadata);
  if (voice.isVoiceTranscript && rawRole === "user") return "user_voice_transcript";
  if (voice.isVoiceTranscript && rawRole === "assistant") return "assistant_voice_transcript";
  if (rawRole === "user") return "user";

  const ordinaryRecipients = new Set(["", "all", "assistant", "user", "none"]);
  if (rawRole === "assistant" && recipient && !ordinaryRecipients.has(recipient)) return "tool_call";
  if (rawRole === "assistant" && authorName && /(?:tool|browser|python|api|connector)/i.test(authorName)) {
    return "tool_call";
  }

  if (
    rawRole === "assistant"
    && (
      channel === "commentary"
      || channel === "analysis"
      || ["progress", "status", "intermediate", "delta"].includes(messageType)
      || ["in_progress", "streaming"].includes(status)
      || metadata.is_visually_hidden_from_conversation === true
    )
  ) {
    return channel === "analysis" ? "reasoning" : "assistant_intermediate";
  }

  if (rawRole === "assistant") return "assistant_final";
  return "unknown";
};

const textFromUnknown = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;
  for (const key of ["transcript", "transcription", "audio_transcript", "voice_transcript", "spoken_text", "caption", "text", "content", "result", "name", "url"]) {
    if (typeof value[key] === "string") return value[key] as string;
  }
  return null;
};

const normalizeSinglePart = (part: unknown, sourceType: string): CanonicalContentPart => {
  if (typeof part === "string") {
    return { type: "text", text: part, rawPayload: part };
  }

  const text = textFromUnknown(part);
  if (sourceType === "code" || (isRecord(part) && (part.type === "code" || part.content_type === "code"))) {
    return {
      type: "code",
      code: text ?? "",
      language: isRecord(part) ? asString(part.language) : null,
      rawPayload: part,
    };
  }

  const knownMap: Record<string, CanonicalContentPart["type"]> = {
    image_asset_pointer: "image",
    image: "image",
    file: "file",
    file_asset_pointer: "file",
    citation: "citation",
    tool_call: "tool_call",
    tool_result: "tool_result",
    canvas: "canvas",
    canvas_asset_pointer: "canvas",
    reasoning_summary: "reasoning_summary",
  };
  const mapped = knownMap[sourceType];
  if (mapped && mapped !== "text" && mapped !== "code" && mapped !== "unknown") {
    return { type: mapped, text, rawPayload: part };
  }

  return {
    type: "unknown",
    sourceType: sourceType || "unknown",
    text,
    rawPayload: part,
  };
};

const forceSemanticContentType = (
  part: CanonicalContentPart,
  semanticType: CanonicalSemanticType,
): CanonicalContentPart => {
  const text = "text" in part ? part.text : "code" in part ? part.code : null;
  if (semanticType === "tool_call") return { type: "tool_call", text, rawPayload: part.rawPayload };
  if (semanticType === "tool_result") return { type: "tool_result", text, rawPayload: part.rawPayload };
  if (semanticType === "reasoning") return { type: "reasoning_summary", text, rawPayload: part.rawPayload };
  return part;
};

const normalizeContent = (
  message: UnknownRecord | null,
  semanticType: CanonicalSemanticType,
): CanonicalContentPart[] => {
  if (!message) return [];
  const content = isRecord(message.content) ? message.content : null;
  const metadata = isRecord(message.metadata) ? message.metadata : {};
  const voice = voiceTranscriptInfo(message, content, metadata);
  if (voice.isVoiceTranscript) {
    return voice.texts.map((text) => ({ type: "text", text, rawPayload: {
      transcript: text,
      sourceFields: voice.sourceFields,
      originalContent: content,
    } }));
  }
  if (!content) return [];

  const sourceType = asString(content.content_type) ?? asString(content.type) ?? "text";
  const parts = Array.isArray(content.parts)
    ? content.parts
    : content.text !== undefined
      ? [content.text]
      : content.result !== undefined
        ? [content.result]
        : [content];

  if (sourceType === "text" || sourceType === "multimodal_text") {
    return parts.map((part) => {
      if (typeof part === "string") return normalizeSinglePart(part, "text");
      const partType = isRecord(part)
        ? asString(part.content_type) ?? asString(part.type) ?? sourceType
        : sourceType;
      return normalizeSinglePart(part, partType);
    }).map((part) => forceSemanticContentType(part, semanticType));
  }
  return parts
    .map((part) => normalizeSinglePart(part, sourceType))
    .map((part) => forceSemanticContentType(part, semanticType));
};

const deriveActivePath = (mapping: UnknownRecord, currentNodeId: string | null): string[] => {
  if (!currentNodeId) return [];
  const reversed: string[] = [];
  const visited = new Set<string>();
  let cursor: string | null = currentNodeId;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const candidate = mapping[cursor];
    const node: UnknownRecord | null = isRecord(candidate) ? candidate : null;
    if (!node) break;
    if (isRecord(node.message)) reversed.push(cursor);
    cursor = asString(node.parent);
  }
  return reversed.reverse();
};

export function normalizeChatGPTConversation(
  raw: unknown,
  options: NormalizeOptions = {},
): CanonicalConversation {
  if (!isRecord(raw)) throw new Error("Source conversation must be an object");
  if (!isRecord(raw.mapping)) throw new Error("Source conversation is missing mapping");

  const conversationId =
    asString(raw.id) ?? asString(raw.conversation_id) ?? asString(raw.conversationId);
  if (!conversationId) throw new Error("Source conversation is missing an ID");

  const mapping = raw.mapping;
  const nodes: Record<string, CanonicalMessageNode> = {};
  const edges: { from: string; to: string }[] = [];

  for (const [nodeId, rawNodeValue] of Object.entries(mapping)) {
    const rawNode = isRecord(rawNodeValue) ? rawNodeValue : {};
    const rawMessage = isRecord(rawNode.message) ? rawNode.message : null;
    const author = rawMessage && isRecord(rawMessage.author) ? rawMessage.author : null;
    const messageMetadata = rawMessage && isRecord(rawMessage.metadata) ? rawMessage.metadata : {};
    const semanticType = semanticTypeForMessage(rawMessage, author, messageMetadata);
    const messageContent = rawMessage && isRecord(rawMessage.content) ? rawMessage.content : null;
    const voiceTranscript = voiceTranscriptInfo(rawMessage, messageContent, messageMetadata);
    const childrenIds = Array.isArray(rawNode.children)
      ? rawNode.children.filter((value): value is string => typeof value === "string")
      : [];
    const parentId = asString(rawNode.parent);

    if (parentId) edges.push({ from: parentId, to: nodeId });

    nodes[nodeId] = {
      nodeId,
      parentId,
      childrenIds,
      messageId: rawMessage ? asString(rawMessage.id) : null,
      role: normalizeRole(author?.role),
      semanticType,
      streamGroupId: rawMessage
        ? firstString(messageMetadata, ["stream_group_id", "streamGroupId", "content_block_id", "contentBlockId", "event_id", "eventId"])
          ?? asString(rawMessage.id)
        : null,
      createdAt: rawMessage ? timestampToIso(rawMessage.create_time) : null,
      updatedAt: rawMessage ? timestampToIso(rawMessage.update_time) : null,
      content: normalizeContent(rawMessage, semanticType),
      model: asString(messageMetadata.model_slug) ?? asString(messageMetadata.model),
      status: rawMessage ? asString(rawMessage.status) : null,
      metadata: {
        ...messageMetadata,
        ...(voiceTranscript.isVoiceTranscript ? {
          kvArchiveVoiceTranscript: true,
          kvArchiveVoiceTranscriptSources: voiceTranscript.sourceFields,
        } : {}),
      },
      rawPayload: rawNodeValue,
    };
  }

  const currentNodeId = asString(raw.current_node);
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    conversationId,
    title: asString(raw.title) ?? "Untitled conversation",
    source: {
      provider: options.provider ?? "chatgpt",
      adapter: options.adapter ?? "fixture",
      sourceUrl: options.sourceUrl ?? null,
      captureMode: options.captureMode ?? "structured",
      completeness: options.completeness ?? "verified",
    },
    createdAt: timestampToIso(raw.create_time),
    updatedAt: timestampToIso(raw.update_time),
    currentNodeId,
    nodes,
    edges,
    activePath: deriveActivePath(mapping, currentNodeId),
    projectId: asString(raw.gizmo_id) ?? asString(raw.conversation_template_id) ?? asString(raw.project_id),
    primaryCollectionId: options.primaryCollectionId ?? asString(raw.gizmo_id) ?? asString(raw.conversation_template_id) ?? asString(raw.project_id),
    collectionRefs: options.collectionRefs ?? (() => {
      const collectionId = asString(raw.gizmo_id) ?? asString(raw.conversation_template_id) ?? asString(raw.project_id);
      if (!collectionId) return [];
      return [{
        provider: options.provider ?? "chatgpt",
        collectionId,
        kind: asString(raw.gizmo_id) ? "project" : "collection",
        title: asString(raw.project_title),
        nativeId: collectionId,
        metadata: {},
      }];
    })(),
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
    rawMetadata: raw,
  };
}
