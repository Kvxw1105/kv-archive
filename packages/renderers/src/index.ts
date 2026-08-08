import type {
  CanonicalContentPart,
  CanonicalConversation,
  CanonicalMessageNode,
  CanonicalSemanticType,
} from "../../domain/src/index.js";

const roleLabel = (role: CanonicalMessageNode["role"]): string => {
  const labels: Record<CanonicalMessageNode["role"], string> = {
    user: "User",
    assistant: "Assistant",
    system: "System",
    tool: "Tool",
    unknown: "Unknown",
  };
  return labels[role];
};

const roleLabelZh = (role: CanonicalMessageNode["role"]): string => {
  const labels: Record<CanonicalMessageNode["role"], string> = {
    user: "你",
    assistant: "ChatGPT",
    system: "系统",
    tool: "工具",
    unknown: "其他",
  };
  return labels[role];
};

type RenderMode = "conversation" | "assistant-only" | "technical";

export interface ActivePathRenderDiagnostics {
  activePathNodes: number;
  coalescedMessages: number;
  includedMessages: number;
  renderedMessages: number;
}

export interface ExportPipelineDiagnostics {
  rawSourceNodes?: number | null;
  parentTraceNodes?: number | null;
  normalizedMessages?: number | null;
  exportedMessages?: number | null;
  captureAdapter?: string | null;
  sourceCompleteness?: string | null;
  selectedCapture?: string | null;
  hydrationOutcome?: string | null;
  hydrationComplete?: boolean | null;
  hydrationIterations?: number | null;
  pageLowerBound?: number | null;
  userVoiceTranscriptMessages?: number | null;
  assistantVoiceTranscriptMessages?: number | null;
  confidenceReasons?: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const safeHref = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (!href || /^(?:javascript|data):/i.test(href)) return null;
  return /^(?:https?:|blob:|sandbox:|obsidian:)/i.test(href) ? href : null;
};

const rawString = (raw: unknown, keys: string[]): string | null => {
  if (!isRecord(raw)) return null;
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const extractTextLinks = (value: string | null | undefined): string[] => {
  if (!value) return [];
  const links = new Set<string>();
  for (const match of value.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const href = safeHref(match[1]);
    if (href) links.add(href);
  }
  for (const match of value.matchAll(/(?:https?:\/\/|blob:|sandbox:)[^\s<>()]+/gi)) {
    const href = safeHref(match[0].replace(/[.,;!?，。；！？]+$/, ""));
    if (href) links.add(href);
  }
  return [...links];
};

const extractPartLinks = (part: CanonicalContentPart): string[] => {
  const links = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    if (depth < 0 || value === null || value === undefined) return;
    if (typeof value === "string") {
      const href = safeHref(value);
      if (href) links.add(href);
      for (const extracted of extractTextLinks(value)) links.add(extracted);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, 24)) visit(entry, depth - 1);
      return;
    }
    if (!isRecord(value)) return;
    const preferred = ["download_url", "downloadUrl", "url", "href", "file_url", "fileUrl", "asset_url", "assetUrl", "sandbox_path", "sandboxPath"];
    for (const key of preferred) visit(value[key], depth - 1);
    for (const [key, entry] of Object.entries(value).slice(0, 80)) {
      if (preferred.includes(key)) continue;
      if (/url|href|link|path/i.test(key)) visit(entry, depth - 1);
    }
  };
  visit(part.rawPayload, 3);
  if ("text" in part) for (const href of extractTextLinks(part.text)) links.add(href);
  return [...links];
};

const partDisplayName = (part: CanonicalContentPart, fallback: string): string => {
  const rawName = rawString(part.rawPayload, ["file_name", "fileName", "filename", "name", "title"]);
  if (rawName) return rawName;
  if ("text" in part && part.text?.trim()) {
    const markdownLabel = part.text.match(/^\[([^\]]+)\]\([^)]+\)$/)?.[1];
    return (markdownLabel || part.text).trim().slice(0, 240);
  }
  return fallback;
};

const partMimeType = (part: CanonicalContentPart): string | null =>
  rawString(part.rawPayload, ["mime_type", "mimeType", "content_type", "contentType"]);

const partSize = (part: CanonicalContentPart): number | null => {
  if (!isRecord(part.rawPayload)) return null;
  for (const key of ["size_bytes", "sizeBytes", "file_size_bytes", "fileSizeBytes"]) {
    const value = part.rawPayload[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
};

const formatBytes = (value: number | null): string => {
  if (value === null) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const isTemporaryHref = (href: string): boolean =>
  /^(?:blob:|sandbox:)/i.test(href) || /[?&](?:expires?|signature|sig|token|x-amz-|x-goog-)/i.test(href);

const renderPartMarkdown = (part: CanonicalContentPart, mode: RenderMode): string => {
  switch (part.type) {
    case "text":
      return part.text;
    case "code":
      return `\`\`\`${part.language ?? ""}\n${part.code}\n\`\`\``;
    case "image":
    case "file":
    case "citation":
    case "canvas": {
      const label = partDisplayName(part, part.type === "image" ? "图片" : part.type === "citation" ? "引用" : part.type === "canvas" ? "Canvas" : "文件");
      const href = extractPartLinks(part)[0];
      const prefix = part.type === "image" ? "图片" : part.type === "citation" ? "引用" : part.type === "canvas" ? "Canvas" : "文件";
      return href ? `[${prefix}：${label}](${href})` : `[${prefix}：${label}]`;
    }
    case "tool_call":
      return mode === "technical" ? (part.text ? `> Tool call: ${part.text}` : "> Tool call") : "";
    case "tool_result": {
      if (mode === "technical") return part.text ? `> Tool result: ${part.text}` : "> Tool result";
      return "";
    }
    case "reasoning_summary":
      return mode === "technical" ? (part.text ? `*Reasoning summary: ${part.text}*` : "*Reasoning summary*") : "";
    case "unknown": {
      if (mode === "technical") return part.text
        ? `[Unsupported content: ${part.sourceType}]\n\n${part.text}`
        : `[Unsupported content: ${part.sourceType}]`;
      return "";
    }
  }
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const renderInlineMarkdown = (value: string): string => {
  let escaped = escapeHtml(value);
  escaped = escaped.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  escaped = escaped.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  escaped = escaped.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  escaped = escaped.replace(/\[([^\]]+)\]\(((?:https?:|blob:|sandbox:)[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
  escaped = escaped.replace(/(^|[\s>])((?:https?:\/\/)[^\s<]+)/g, (match, prefix, href) => `${prefix}<a href="${href}" target="_blank" rel="noreferrer noopener">${href}</a>`);
  return escaped;
};

const renderCodeHtml = (code: string, language: string | null | undefined): string => {
  const label = String(language || "代码").trim() || "代码";
  return `<div class="code-block"><div class="code-toolbar"><span>${escapeHtml(label)}</span><button type="button" class="copy-code" data-copy-code>复制代码</button></div><pre><code${language ? ` data-language="${escapeHtml(language)}"` : ""}>${escapeHtml(code)}</code></pre></div>`;
};

const isTableSeparator = (line: string): boolean => {
  const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
};

const splitTableRow = (line: string): string[] =>
  line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());

const renderTextHtml = (value: string): string => {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let unordered: string[] = [];
  let ordered: string[] = [];
  let quote: string[] = [];
  let code: string[] = [];
  let codeLanguage = "";
  let inCode = false;

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${paragraph.map(renderInlineMarkdown).join("<br>")}</p>`);
      paragraph = [];
    }
  };
  const flushUnordered = (): void => {
    if (unordered.length > 0) {
      blocks.push(`<ul>${unordered.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
      unordered = [];
    }
  };
  const flushOrdered = (): void => {
    if (ordered.length > 0) {
      blocks.push(`<ol>${ordered.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ol>`);
      ordered = [];
    }
  };
  const flushQuote = (): void => {
    if (quote.length > 0) {
      blocks.push(`<blockquote>${quote.map(renderInlineMarkdown).join("<br>")}</blockquote>`);
      quote = [];
    }
  };
  const flushCode = (): void => {
    blocks.push(renderCodeHtml(code.join("\n"), codeLanguage));
    code = [];
    codeLanguage = "";
  };
  const flushFlow = (): void => {
    flushParagraph();
    flushUnordered();
    flushOrdered();
    flushQuote();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fence = line.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      flushFlow();
      if (inCode) flushCode();
      else codeLanguage = fence[1] ?? "";
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }

    const nextLine = lines[index + 1] ?? "";
    if (line.includes("|") && isTableSeparator(nextLine)) {
      flushFlow();
      const header = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? "").includes("|") && (lines[index] ?? "").trim()) {
        rows.push(splitTableRow(lines[index] ?? ""));
        index += 1;
      }
      index -= 1;
      blocks.push(`<div class="table-wrap"><table><thead><tr>${header.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${header.map((_, cellIndex) => `<td>${renderInlineMarkdown(row[cellIndex] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushFlow();
      const level = Math.min(4, heading[1]?.length ?? 2);
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2] ?? "")}</h${level}>`);
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushFlow();
      blocks.push("<hr>");
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      flushOrdered();
      flushQuote();
      unordered.push(bullet[1] ?? "");
      continue;
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      flushUnordered();
      flushQuote();
      ordered.push(numbered[1] ?? "");
      continue;
    }
    const quoteLine = line.match(/^>\s?(.*)$/);
    if (quoteLine) {
      flushParagraph();
      flushUnordered();
      flushOrdered();
      quote.push(quoteLine[1] ?? "");
      continue;
    }
    if (line.trim() === "") {
      flushFlow();
      continue;
    }
    flushUnordered();
    flushOrdered();
    flushQuote();
    paragraph.push(line);
  }

  if (inCode) flushCode();
  flushFlow();
  return blocks.join("\n");
};

const renderAttachmentHtml = (part: CanonicalContentPart, fallback: string, icon: string, sourceUrl: string | null): string => {
  const name = partDisplayName(part, fallback);
  const links = extractPartLinks(part);
  const primary = links[0] ?? null;
  const mime = partMimeType(part);
  const size = partSize(part);
  const details = [mime, formatBytes(size)].filter(Boolean).join(" · ");
  const actions = [
    primary ? `<a class="attachment-action" href="${escapeHtml(primary)}" target="_blank" rel="noreferrer noopener">${isTemporaryHref(primary) ? "尝试打开" : "打开或下载"}</a>` : "",
    sourceUrl ? `<a class="attachment-action secondary-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer noopener">打开原对话</a>` : "",
  ].filter(Boolean).join("");
  const warning = primary && isTemporaryHref(primary) ? `<span class="attachment-warning">链接可能依赖登录状态或已经过期</span>` : "";
  return `<div class="attachment"><span class="attachment-icon">${icon}</span><div class="attachment-body"><strong>${escapeHtml(name)}</strong>${details ? `<span>${escapeHtml(details)}</span>` : ""}${warning}${actions ? `<div class="attachment-actions">${actions}</div>` : ""}</div></div>`;
};

const renderPartHtml = (part: CanonicalContentPart, mode: RenderMode, sourceUrl: string | null): string => {
  switch (part.type) {
    case "text":
      return renderTextHtml(part.text);
    case "code":
      return renderCodeHtml(part.code, part.language);
    case "image":
      return renderAttachmentHtml(part, "图片", "▧", sourceUrl);
    case "file":
      return renderAttachmentHtml(part, "文件", "↧", sourceUrl);
    case "citation":
      return renderAttachmentHtml(part, "引用", "↗", sourceUrl);
    case "canvas":
      return renderAttachmentHtml(part, "Canvas", "◇", sourceUrl);
    case "tool_call":
      return mode === "technical" ? `<details class="technical"><summary>工具调用</summary><pre>${escapeHtml(part.text ?? "")}</pre></details>` : "";
    case "tool_result": {
      if (mode === "technical") {
        const links = extractPartLinks(part);
        const actions = links.map((href, index) => `<a class="attachment-action" href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">打开结果 ${index + 1}</a>`).join("");
        return `<details class="technical"><summary>工具结果</summary><pre>${escapeHtml(part.text ?? "")}</pre>${actions ? `<div class="technical-actions">${actions}</div>` : ""}</details>`;
      }
      return "";
    }
    case "reasoning_summary":
      return mode === "technical" ? `<details class="technical"><summary>推理摘要</summary>${part.text ? `<div class="technical-body">${escapeHtml(part.text)}</div>` : ""}</details>` : "";
    case "unknown": {
      if (mode === "technical") return `<details class="technical"><summary>未识别内容（原始证据已保留）</summary><pre>${escapeHtml(part.text ?? part.sourceType)}</pre></details>`;
      return "";
    }
  }
};

const normalizedPreview = (node: CanonicalMessageNode, limit = 72): string => {
  const value = node.content.map((part) => renderPartMarkdown(part, "conversation")).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (!value) return roleLabelZh(node.role);
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
};

const formatDateLabel = (value: string | null): string => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const avatarHtml = (role: CanonicalMessageNode["role"]): string => {
  if (role === "assistant") {
    return `<span class="avatar assistant-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" role="img"><path d="M12 2.7a4.2 4.2 0 0 1 4 2.8 4.2 4.2 0 0 1 4.9 5.7 4.2 4.2 0 0 1-1.1 5.4 4.2 4.2 0 0 1-4 4.7 4.2 4.2 0 0 1-5.1-1.3 4.2 4.2 0 0 1-4.9-1.5 4.2 4.2 0 0 1-1.2-5.6 4.2 4.2 0 0 1 1.3-5.2A4.2 4.2 0 0 1 12 2.7Zm0 2.1L8.1 7v4.5l3.9 2.2 3.9-2.2V7L12 4.8Zm-5.5 4-.1 4.5 3.9 2.2v4.4l-3.8-2.3-3.8-2.2.1-4.4 3.7-2.2Zm11 0 3.8 2.2.1 4.4-3.8 2.2-3.8 2.3v-4.4l3.9-2.2-.2-4.5Zm-9.3-.7L12 5.9l3.8 2.2v4.4L12 14.7l-3.8-2.2V8.1Z" fill="currentColor"/></svg></span>`;
  }
  if (role === "user") return `<span class="avatar user-avatar" aria-hidden="true">你</span>`;
  if (role === "tool") return `<span class="avatar neutral-avatar" aria-hidden="true">T</span>`;
  if (role === "system") return `<span class="avatar neutral-avatar" aria-hidden="true">S</span>`;
  return `<span class="avatar neutral-avatar" aria-hidden="true">·</span>`;
};


const semanticTypeOf = (node: CanonicalMessageNode): CanonicalSemanticType => {
  if (node.semanticType) return node.semanticType;
  if (node.role === "user") return "user";
  if (node.role === "tool") return "tool_result";
  if (node.role === "system") return "system";
  if (node.role === "assistant") {
    const hasUserVisiblePart = node.content.some((part) =>
      part.type === "text"
        ? Boolean(part.text.trim())
        : part.type === "code"
          ? Boolean(part.code.trim())
          : ["image", "file", "citation", "canvas"].includes(part.type),
    );
    if (hasUserVisiblePart) return "assistant_final";
    if (node.content.some((part) => part.type === "tool_call")) return "tool_call";
    if (node.content.some((part) => part.type === "tool_result")) return "tool_result";
    if (node.content.some((part) => part.type === "reasoning_summary")) return "reasoning";
    return "assistant_final";
  }
  return "unknown";
};

const semanticLabel = (node: CanonicalMessageNode, locale: "en" | "zh" = "zh"): string => {
  const semantic = semanticTypeOf(node);
  const labels = locale === "zh"
    ? {
        user: "你",
        user_voice_transcript: "你",
        assistant_final: "ChatGPT",
        assistant_voice_transcript: "ChatGPT",
        assistant_intermediate: "中间过程",
        tool_call: "工具调用",
        tool_result: "工具结果",
        reasoning: "推理摘要",
        system: "系统",
        developer: "开发者指令",
        unknown: "未识别事件",
      }
    : {
        user: "User",
        user_voice_transcript: "User",
        assistant_final: "Assistant",
        assistant_voice_transcript: "Assistant",
        assistant_intermediate: "Intermediate assistant event",
        tool_call: "Tool call",
        tool_result: "Tool result",
        reasoning: "Reasoning summary",
        system: "System",
        developer: "Developer",
        unknown: "Unknown event",
      };
  return labels[semantic];
};

const nodeIncludedInMode = (node: CanonicalMessageNode, mode: RenderMode): boolean => {
  if (mode === "technical") return true;
  const semantic = semanticTypeOf(node);
  if (mode === "assistant-only") return semantic === "assistant_final" || semantic === "assistant_voice_transcript";
  return ["user", "user_voice_transcript", "assistant_final", "assistant_voice_transcript"].includes(semantic);
};

const partIdentity = (part: CanonicalContentPart): string => {
  if (part.type === "text") return `text:${part.text}`;
  if (part.type === "code") return `code:${part.language ?? ""}:${part.code}`;
  if ("text" in part) return `${part.type}:${part.text ?? ""}:${JSON.stringify(part.rawPayload ?? null)}`;
  return JSON.stringify(part);
};

const mergeText = (previous: string, next: string): string => {
  if (!previous) return next;
  if (!next) return previous;
  if (next.startsWith(previous)) return next;
  if (previous.startsWith(next)) return previous;
  return `${previous}${next}`;
};

const mergeContentParts = (base: CanonicalContentPart[], incoming: CanonicalContentPart[]): CanonicalContentPart[] => {
  const result = base.map((part) => ({ ...part })) as CanonicalContentPart[];
  for (const next of incoming) {
    const last = result.at(-1);
    if (last?.type === "text" && next.type === "text") {
      last.text = mergeText(last.text, next.text);
      continue;
    }
    if (last?.type === "code" && next.type === "code" && last.language === next.language) {
      last.code = mergeText(last.code, next.code);
      continue;
    }
    const identity = partIdentity(next);
    if (result.some((part) => partIdentity(part) === identity)) continue;
    result.push({ ...next } as CanonicalContentPart);
  }
  return result;
};

/**
 * ChatGPT may expose cumulative or delta fragments as separate graph events.
 * Coalesce only when the provider supplied an explicit stable grouping key (or
 * the same message id), and keep unrelated assistant events separate.
 */
const coalesceActivePathNodes = (conversation: CanonicalConversation): CanonicalMessageNode[] => {
  const nodes = conversation.activePath
    .map((nodeId) => conversation.nodes[nodeId])
    .filter((node): node is CanonicalMessageNode => Boolean(node));
  const output: CanonicalMessageNode[] = [];
  for (const node of nodes) {
    const previous = output.at(-1);
    const sameGroup = Boolean(
      previous
      && semanticTypeOf(previous) === semanticTypeOf(node)
      && previous.role === node.role
      && (
        (previous.streamGroupId && node.streamGroupId && previous.streamGroupId === node.streamGroupId)
        || (previous.messageId && node.messageId && previous.messageId === node.messageId)
      ),
    );
    if (!sameGroup || !previous) {
      output.push({ ...node, content: node.content.map((part) => ({ ...part })) as CanonicalContentPart[] });
      continue;
    }
    previous.content = mergeContentParts(previous.content, node.content);
    previous.updatedAt = node.updatedAt ?? previous.updatedAt;
    previous.status = node.status ?? previous.status;
    previous.childrenIds = [...new Set([...previous.childrenIds, ...node.childrenIds])];
  }
  return output;
};

const isTechnicalSemantic = (node: CanonicalMessageNode): boolean =>
  !["user", "user_voice_transcript", "assistant_final", "assistant_voice_transcript"].includes(semanticTypeOf(node));

const isVoiceTranscriptSemantic = (node: CanonicalMessageNode): boolean =>
  ["user_voice_transcript", "assistant_voice_transcript"].includes(semanticTypeOf(node));

const modeLabel = (mode: RenderMode): string => {
  if (mode === "technical") return "完整技术记录";
  if (mode === "assistant-only") return "仅 AI 正式回答";
  return "精简对话";
};

export function getActivePathRenderDiagnostics(
  conversation: CanonicalConversation,
  options: { mode?: RenderMode } = {},
): ActivePathRenderDiagnostics {
  const mode = options.mode ?? "conversation";
  const sourceUrl = safeHref(conversation.source.sourceUrl);
  const coalesced = coalesceActivePathNodes(conversation);
  const included = coalesced.filter((node) => nodeIncludedInMode(node, mode));
  const rendered = included.filter((node) =>
    node.content.some((part) => Boolean(renderPartHtml(part, mode, sourceUrl))),
  );
  return {
    activePathNodes: conversation.activePath.length,
    coalescedMessages: coalesced.length,
    includedMessages: included.length,
    renderedMessages: rendered.length,
  };
}

export function renderActivePathMarkdown(
  conversation: CanonicalConversation,
  options: { mode?: RenderMode } = {},
): string {
  const mode = options.mode ?? "conversation";
  const messages = coalesceActivePathNodes(conversation)
    .filter((node) => nodeIncludedInMode(node, mode));

  const sections = messages.flatMap((node, index) => {
    const body = node.content.map((part) => renderPartMarkdown(part, mode)).filter(Boolean).join("\n\n").trim();
    if (!body) return [];
    return [`## ${index + 1}. ${semanticLabel(node, "en")}\n\n${body}`];
  });

  const header = [
    `# ${conversation.title}`,
    "",
    `- Conversation ID: ${conversation.conversationId}`,
    `- Schema: ${conversation.schemaVersion}`,
    `- Export mode: ${mode}`,
    `- Active path messages: ${messages.length}`,
    `- Total graph nodes: ${Object.keys(conversation.nodes).length}`,
  ].join("\n");

  return `${header}\n\n${sections.join("\n\n")}\n`;
}

export function renderReadableHtml(
  conversation: CanonicalConversation,
  options: { integrityStatus?: string; mode?: RenderMode; diagnostics?: ExportPipelineDiagnostics } = {},
): string {
  const mode = options.mode ?? "conversation";
  const sourceUrl = safeHref(conversation.source.sourceUrl);
  const activeMessages = coalesceActivePathNodes(conversation);
  const messages = activeMessages.filter((node) => {
    if (!nodeIncludedInMode(node, mode)) return false;
    return node.content.some((part) => Boolean(renderPartHtml(part, mode, sourceUrl)));
  });
  const totalNodes = Object.keys(conversation.nodes).length;
  const branchNodes = Math.max(0, totalNodes - activeMessages.length);
  const status = options.integrityStatus ?? "UNKNOWN";
  const statusLabel = status === "COMPLETE"
    ? "已验证完整"
    : status === "PARTIAL"
      ? "可能不完整"
      : status === "FAILED"
        ? "失败"
        : "未验证";
  const tocMessages = messages.filter((node) => ["user", "user_voice_transcript"].includes(semanticTypeOf(node)));
  const tocSource = tocMessages.length > 0 ? tocMessages : messages;
  const pipeline = options.diagnostics;
  const diagnosticHtml = pipeline ? (() => {
    const details = [
      pipeline.captureAdapter ? `采集器：${pipeline.captureAdapter}` : null,
      pipeline.selectedCapture ? `选用来源：${pipeline.selectedCapture}` : null,
      pipeline.sourceCompleteness ? `来源完整性：${pipeline.sourceCompleteness}` : null,
      pipeline.hydrationOutcome ? `页面回溯：${pipeline.hydrationOutcome}${pipeline.hydrationIterations != null ? `（${pipeline.hydrationIterations} 步）` : ""}` : null,
      pipeline.pageLowerBound != null ? `页面可推断下限：${pipeline.pageLowerBound}` : null,
      pipeline.userVoiceTranscriptMessages != null || pipeline.assistantVoiceTranscriptMessages != null
        ? `语音转录：用户 ${pipeline.userVoiceTranscriptMessages ?? 0} 条，AI ${pipeline.assistantVoiceTranscriptMessages ?? 0} 条`
        : null,
      pipeline.confidenceReasons?.length ? `置信警告：${pipeline.confidenceReasons.join(", ")}` : null,
    ].filter((value): value is string => Boolean(value));
    const detailHtml = details.map((value) => `<p>${escapeHtml(value)}</p>`).join("");
    return `<details class="export-diagnostics"><summary>导出诊断（A → D）</summary><div class="diagnostic-grid"><div><span>A · 原始来源节点</span><strong>${pipeline.rawSourceNodes ?? "未知"}</strong></div><div><span>B · 父链／页面累积</span><strong>${pipeline.parentTraceNodes ?? "未知"}</strong></div><div><span>C · 语义归一化</span><strong>${pipeline.normalizedMessages ?? "未知"}</strong></div><div><span>D · 当前模式导出</span><strong>${pipeline.exportedMessages ?? messages.length}</strong></div></div>${detailHtml}</details>`;
  })() : "";

  let activeTocMessageIndex = messages.findIndex((node) => node.role === "user") + 1;
  const messageHtml = messages.map((node, index) => {
    const messageIndex = index + 1;
    if (node.role === "user" || tocMessages.length === 0) activeTocMessageIndex = messageIndex;
    const renderedParts = node.content.map((part) => renderPartHtml(part, mode, sourceUrl)).filter(Boolean).join("\n");
    const content = mode === "technical" && isTechnicalSemantic(node) && !["tool_call", "tool_result", "reasoning"].includes(semanticTypeOf(node))
      ? `<details class="technical"><summary>${escapeHtml(semanticLabel(node))}</summary><div class="technical-body">${renderedParts}</div></details>`
      : renderedParts;
    const role = semanticLabel(node);
    const timestamp = formatDateLabel(node.createdAt);
    const semantic = semanticTypeOf(node);
    const voiceBadge = mode === "technical" && isVoiceTranscriptSemantic(node)
      ? `<span class="voice-transcript-badge" title="来自 ChatGPT Voice / Live 转录">语音转录</span>`
      : "";
    return `<article id="message-${messageIndex}" class="message ${node.role}" data-message-index="${messageIndex}" data-role="${escapeHtml(node.role)}" data-semantic-type="${escapeHtml(semantic)}" data-toc-target="message-${activeTocMessageIndex || messageIndex}">
      <div class="message-row">
        ${avatarHtml(node.role)}
        <div class="message-column">
          <div class="message-meta"><strong>${escapeHtml(role)}</strong>${voiceBadge}${timestamp ? `<time>${escapeHtml(timestamp)}</time>` : ""}<button class="copy-message" type="button" data-copy-message aria-label="复制本条消息">复制</button></div>
          <div class="message-content">${content}</div>
        </div>
      </div>
    </article>`;
  }).join("\n");

  const tocHtml = tocSource.map((node) => {
    const messageIndex = messages.indexOf(node) + 1;
    return `<a class="toc-link" href="#message-${messageIndex}" data-target="message-${messageIndex}"><span>${messageIndex}</span><em>${escapeHtml(normalizedPreview(node))}</em></a>`;
  }).join("\n");

  return `<!doctype html>
<html lang="zh-CN" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(conversation.title)} - KV Archive</title>
<style>
:root{color-scheme:light;--page:#fff;--surface:#fff;--surface-2:#f7f7f8;--surface-3:#ececf1;--text:#0d0d0d;--muted:#676767;--faint:#8f8f8f;--line:#e5e5e5;--user:#f4f4f4;--accent:#10a37f;--accent-soft:#e7f7f2;--code:#0d0d0d;--code-head:#2f2f2f;--code-text:#f7f7f8;--mark:#ffe58f;--shadow:0 14px 40px rgba(0,0,0,.09)}html[data-theme="dark"]{color-scheme:dark;--page:#212121;--surface:#212121;--surface-2:#2f2f2f;--surface-3:#424242;--text:#ececec;--muted:#b4b4b4;--faint:#8e8e8e;--line:#3a3a3a;--user:#2f2f2f;--accent:#19c37d;--accent-soft:#173c31;--code:#0d0d0d;--code-head:#2f2f2f;--code-text:#f7f7f8;--mark:#6c5612;--shadow:0 16px 42px rgba(0,0,0,.3)}@media(prefers-color-scheme:dark){html[data-theme="auto"]{color-scheme:dark;--page:#212121;--surface:#212121;--surface-2:#2f2f2f;--surface-3:#424242;--text:#ececec;--muted:#b4b4b4;--faint:#8e8e8e;--line:#3a3a3a;--user:#2f2f2f;--accent:#19c37d;--accent-soft:#173c31;--code:#0d0d0d;--code-head:#2f2f2f;--code-text:#f7f7f8;--mark:#6c5612;--shadow:0 16px 42px rgba(0,0,0,.3)}}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--page);color:var(--text);font:15.5px/1.72 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;text-rendering:optimizeLegibility}.app{min-height:100vh}.topbar{position:sticky;top:0;z-index:30;height:58px;display:flex;align-items:center;gap:10px;padding:0 18px;border-bottom:1px solid color-mix(in srgb,var(--line) 76%,transparent);background:color-mix(in srgb,var(--page) 88%,transparent);backdrop-filter:blur(18px)}.topbar-title{min-width:0;flex:1;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.topbar-actions{display:flex;align-items:center;gap:7px}.icon-button,.search-button{border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:10px;height:36px;padding:0 11px;font:inherit;cursor:pointer}.icon-button:hover,.search-button:hover{background:var(--surface-2)}.toc-toggle{display:none}.layout{display:grid;grid-template-columns:minmax(0,1fr);min-height:calc(100vh - 58px)}.toc{position:fixed;z-index:24;left:16px;top:74px;bottom:16px;width:278px;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:16px;background:color-mix(in srgb,var(--surface) 94%,transparent);box-shadow:var(--shadow);overflow:hidden}.toc-head{padding:16px 16px 12px;border-bottom:1px solid var(--line)}.toc-head strong{display:block;font-size:14px}.toc-head span{display:block;margin-top:3px;color:var(--muted);font-size:12px}.toc-list{padding:8px;overflow:auto;overscroll-behavior:contain}.toc-link{display:grid;grid-template-columns:24px minmax(0,1fr);gap:8px;align-items:start;padding:9px 10px;border-radius:10px;color:var(--muted);text-decoration:none}.toc-link span{display:grid;place-items:center;width:22px;height:22px;border-radius:7px;background:var(--surface-2);font-size:11px;font-weight:700}.toc-link em{font-style:normal;font-size:12px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.toc-link:hover{background:var(--surface-2);color:var(--text)}.toc-link.active{background:var(--accent-soft);color:var(--text)}.conversation{width:min(100%,820px);margin:0 auto;padding:42px 28px 100px}.conversation-header{padding:4px 0 34px}.eyebrow{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px;letter-spacing:.04em}.eyebrow-dot{width:8px;height:8px;border-radius:50%;background:var(--accent)}h1{font-size:clamp(28px,4.8vw,42px);line-height:1.16;letter-spacing:-.025em;margin:14px 0 16px}.header-meta{display:flex;gap:8px;flex-wrap:wrap}.meta-pill{padding:6px 10px;border-radius:999px;background:var(--surface-2);color:var(--muted);font-size:12px}.export-diagnostics{margin:18px 0 0;border:1px solid var(--line);border-radius:13px;background:var(--surface-2);color:var(--muted)}.export-diagnostics summary{cursor:pointer;padding:11px 13px;font-size:12px;font-weight:650;color:var(--text)}.diagnostic-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:0 12px 12px}.diagnostic-grid div{padding:9px;border-radius:9px;background:var(--surface)}.diagnostic-grid span{display:block;font-size:11px}.diagnostic-grid strong{display:block;margin-top:4px;color:var(--text);font-size:16px}.export-diagnostics p{margin:0;padding:0 13px 12px;font-size:11px}@media(max-width:720px){.diagnostic-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}.search-panel{position:sticky;top:68px;z-index:18;display:none;grid-template-columns:minmax(0,1fr) auto auto auto;gap:7px;padding:10px;margin:0 0 18px;border:1px solid var(--line);border-radius:15px;background:color-mix(in srgb,var(--surface) 93%,transparent);box-shadow:var(--shadow);backdrop-filter:blur(16px)}.search-panel.open{display:grid}.search-panel input{min-width:0;border:0;outline:0;background:transparent;color:var(--text);padding:0 8px;font:inherit}.search-count{align-self:center;min-width:64px;color:var(--muted);font-size:12px;text-align:center}.search-panel button{border:0;border-radius:9px;background:var(--surface-2);color:var(--text);padding:8px 10px;cursor:pointer}.message{position:relative;scroll-margin-top:132px;padding:22px 0}.message+.message{border-top:1px solid color-mix(in srgb,var(--line) 55%,transparent)}.message-row{display:flex;align-items:flex-start;gap:14px}.avatar{flex:0 0 30px;width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font-size:12px;font-weight:750}.assistant-avatar{background:#111;color:#fff}.assistant-avatar svg{width:20px;height:20px}.user-avatar{background:var(--surface-3);color:var(--text)}.neutral-avatar{background:var(--surface-2);color:var(--muted)}.message-column{min-width:0;flex:1}.message-meta{min-height:28px;display:flex;align-items:center;gap:9px;margin-bottom:8px;color:var(--muted);font-size:12px}.message-meta strong{color:var(--text);font-size:14px}.voice-transcript-badge{display:inline-flex;align-items:center;padding:2px 6px;border-radius:999px;background:var(--surface-2);color:var(--muted);font-size:10px;line-height:1.4}.message-meta time{white-space:nowrap}.copy-message{margin-left:auto;opacity:0;border:0;border-radius:8px;background:transparent;color:var(--muted);padding:5px 8px;cursor:pointer}.message:hover .copy-message,.copy-message:focus{opacity:1}.copy-message:hover{background:var(--surface-2);color:var(--text)}.message-content{font-size:16px;overflow-wrap:anywhere}.message.user .message-row{flex-direction:row-reverse}.message.user .user-avatar,.message.user .message-meta strong{display:none}.message.user .message-column{display:flex;flex-direction:column;align-items:flex-end}.message.user .message-meta{width:min(86%,680px);flex-direction:row-reverse}.message.user .copy-message{margin-left:0;margin-right:auto}.message.user .message-content{width:fit-content;max-width:min(86%,680px);padding:12px 16px;border-radius:18px;background:var(--user)}.message.system .message-content,.message.tool .message-content,.message.unknown .message-content{padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);color:var(--muted)}.message-content p{margin:0 0 1em}.message-content p:last-child{margin-bottom:0}.message-content h1,.message-content h2,.message-content h3,.message-content h4{line-height:1.3;margin:1.45em 0 .55em}.message-content h1{font-size:1.55em}.message-content h2{font-size:1.35em}.message-content h3{font-size:1.17em}.message-content h4{font-size:1.04em}.message-content ul,.message-content ol{padding-left:1.55em;margin:.7em 0 1em}.message-content li+li{margin-top:.35em}.message-content blockquote{margin:1em 0;padding:2px 0 2px 16px;border-left:3px solid var(--line);color:var(--muted)}.message-content hr{border:0;border-top:1px solid var(--line);margin:1.5em 0}.message-content a{color:var(--accent);text-decoration-thickness:1px;text-underline-offset:3px}.message-content p code,.message-content li code,.message-content td code{padding:.15em .35em;border-radius:5px;background:var(--surface-2);font:13px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}.code-block{margin:1em 0;border-radius:12px;overflow:hidden;background:var(--code);color:var(--code-text)}.code-toolbar{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--code-head);font-size:12px;color:#d1d1d1}.copy-code{border:0;background:transparent;color:#d1d1d1;cursor:pointer;font:inherit}.copy-code:hover{color:#fff}.code-block pre{margin:0;padding:16px;overflow:auto;line-height:1.55}.code-block code{font:13px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}.table-wrap{max-width:100%;margin:1em 0;overflow:auto;border:1px solid var(--line);border-radius:10px}.table-wrap table{border-collapse:collapse;width:100%;min-width:420px}.table-wrap th,.table-wrap td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}.table-wrap th{background:var(--surface-2);font-size:13px}.table-wrap tr:last-child td{border-bottom:0}.attachment{display:flex;align-items:flex-start;gap:11px;margin:10px 0;padding:11px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.attachment-icon{display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;border-radius:9px;background:var(--surface);font-size:17px}.attachment-body{display:flex;min-width:0;flex:1;flex-direction:column}.attachment span:not(.attachment-icon){color:var(--muted);font-size:13px}.attachment-actions{display:flex;flex-direction:row!important;flex-wrap:wrap;gap:8px;margin-top:8px}.attachment-action{display:inline-flex!important;width:auto;padding:5px 8px;border:1px solid var(--line);border-radius:8px;color:var(--text)!important;text-decoration:none;font-size:12px!important}.attachment-action:hover{background:var(--surface-3)}.attachment-warning{margin-top:5px;color:#a66b00!important}.secondary-link{color:var(--muted)!important}.technical{margin:10px 0;border:1px solid var(--line);border-radius:10px;background:var(--surface-2)}.technical summary{cursor:pointer;padding:10px 12px;color:var(--muted)}.technical pre{white-space:pre-wrap;overflow:auto;padding:0 12px 12px;margin:0;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}.technical-body{padding:0 12px 12px;color:var(--muted);white-space:pre-wrap}.technical-actions{display:flex;flex-wrap:wrap;gap:8px;padding:0 12px 12px}.empty{color:var(--muted)}mark[data-cv-hit]{background:var(--mark);color:inherit;border-radius:3px;padding:0 .05em}.searching .message:not(.search-hit){opacity:.32}.message.search-hit-current::before{content:"";position:absolute;inset:10px -14px;border:2px solid var(--accent);border-radius:14px;pointer-events:none}.footer{padding-top:36px;margin-top:30px;border-top:1px solid var(--line);color:var(--muted);font-size:12px;text-align:center}.toast{position:fixed;right:18px;bottom:18px;z-index:50;padding:10px 14px;border-radius:10px;background:#111;color:#fff;box-shadow:var(--shadow);font-size:13px;opacity:0;transform:translateY(8px);pointer-events:none;transition:.18s ease}.toast.show{opacity:1;transform:none}.toc-backdrop{display:none}
@media(min-width:1220px){.conversation{transform:translateX(118px)}}@media(max-width:1219px){.toc-toggle{display:inline-flex;align-items:center}.toc{left:-310px;transition:left .2s ease}.toc-open .toc{left:14px}.toc-backdrop{display:block;position:fixed;inset:58px 0 0;z-index:22;background:rgba(0,0,0,.36);opacity:0;pointer-events:none;transition:opacity .2s}.toc-open .toc-backdrop{opacity:1;pointer-events:auto}}@media(max-width:720px){.topbar{padding:0 10px}.conversation{padding:28px 16px 72px}.message{padding:18px 0}.message-row{gap:10px}.avatar{width:28px;height:28px;flex-basis:28px}.message.user .message-content,.message.user .message-meta{max-width:92%;width:auto}.search-panel{grid-template-columns:minmax(0,1fr) auto auto}.search-count{grid-column:1/-1;text-align:left;padding-left:8px}.toc{width:min(88vw,320px)}.message-meta time{display:none}}@media print{.topbar,.toc,.toc-backdrop,.search-panel,.copy-message,.copy-code,.toast{display:none!important}.conversation{width:100%;max-width:820px;padding:0;transform:none}.message{break-inside:avoid}.message.user .message-content{border:1px solid #ddd}}
</style>
</head>
<body>
<div class="app">
  <header class="topbar">
    <button id="toc-toggle" class="icon-button toc-toggle" type="button" aria-label="打开滚动目录">目录</button>
    <div class="topbar-title">${escapeHtml(conversation.title)}</div>
    <div class="topbar-actions">
      <button id="search-toggle" class="search-button" type="button" title="搜索（Ctrl/⌘ + K）">搜索</button>
      <button id="theme-toggle" class="icon-button" type="button" title="切换主题">主题</button>
    </div>
  </header>
  <div class="layout">
    <aside id="conversation-toc" class="toc" aria-label="滚动悬浮目录">
      <div class="toc-head"><strong>对话目录</strong><span>${tocSource.length} 个用户提问 · 点击跳转</span></div>
      <nav class="toc-list">${tocHtml}</nav>
    </aside>
    <button id="toc-backdrop" class="toc-backdrop" type="button" aria-label="关闭目录"></button>
    <main class="conversation">
      <section class="conversation-header">
        <div class="eyebrow"><span class="eyebrow-dot"></span>KV ARCHIVE · CHATGPT 对话镜像</div>
        <h1>${escapeHtml(conversation.title)}</h1>
        <div class="header-meta">
          <span class="meta-pill">${messages.length} 条当前分支消息</span>
          <span class="meta-pill">完整性：${statusLabel}</span>
          ${branchNodes > 0 ? `<span class="meta-pill">另存 ${branchNodes} 个历史分支节点</span>` : ""}
          ${conversation.projectId ? `<span class="meta-pill">Project：${escapeHtml(conversation.projectId)}</span>` : ""}
          <span class="meta-pill">内容：${escapeHtml(modeLabel(mode))}</span>
        </div>
        ${diagnosticHtml}
      </section>
      <section id="search-panel" class="search-panel" aria-label="对话搜索">
        <input id="search-input" type="search" placeholder="搜索本次对话，Enter 跳到下一处…" autocomplete="off" spellcheck="false">
        <span id="search-count" class="search-count">0 / 0</span>
        <button id="search-prev" type="button" title="上一处（Shift + Enter）">上一处</button>
        <button id="search-next" type="button" title="下一处（Enter）">下一处</button>
      </section>
      <section id="messages">${messageHtml}</section>
      <footer class="footer">由 KV Archive 在本地生成 · ${mode === "technical" ? "工具与推理摘要默认折叠" : mode === "assistant-only" ? "仅保留 AI 正式回答" : "仅保留用户问题与 AI 正式回答"}</footer>
    </main>
  </div>
</div>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<script>
(()=>{
  const root=document.documentElement,body=document.body,messages=[...document.querySelectorAll('.message')],tocLinks=[...document.querySelectorAll('.toc-link')];
  const searchPanel=document.getElementById('search-panel'),searchInput=document.getElementById('search-input'),searchCount=document.getElementById('search-count');
  const toast=document.getElementById('toast');let matches=[],current=-1,toastTimer=0;
  const showToast=(text)=>{toast.textContent=text;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),1400)};
  const copyText=async(text)=>{try{await navigator.clipboard.writeText(text);showToast('已复制')}catch{const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();document.execCommand('copy');area.remove();showToast('已复制')}};
  document.addEventListener('click',(event)=>{const codeButton=event.target.closest('[data-copy-code]');if(codeButton){const code=codeButton.closest('.code-block')?.querySelector('code')?.textContent||'';copyText(code);codeButton.textContent='已复制';setTimeout(()=>codeButton.textContent='复制代码',1200);return}const messageButton=event.target.closest('[data-copy-message]');if(messageButton){const text=messageButton.closest('.message')?.querySelector('.message-content')?.innerText||'';copyText(text)}});
  const clearMarks=()=>{document.querySelectorAll('mark[data-cv-hit]').forEach(mark=>mark.replaceWith(document.createTextNode(mark.textContent||'')));messages.forEach(message=>{message.classList.remove('search-hit','search-hit-current');message.querySelector('.message-content')?.normalize()})};
  const markText=(container,query)=>{const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT,{acceptNode(node){const parent=node.parentElement;if(!parent||parent.closest('mark,button,summary,script,style'))return NodeFilter.FILTER_REJECT;return node.nodeValue&&node.nodeValue.toLocaleLowerCase().includes(query)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT}});const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);for(const node of nodes){let source=node.nodeValue||'',lower=source.toLocaleLowerCase(),offset=0,index=lower.indexOf(query);if(index<0)continue;const fragment=document.createDocumentFragment();while(index>=0){fragment.append(document.createTextNode(source.slice(offset,index)));const mark=document.createElement('mark');mark.dataset.cvHit='';mark.textContent=source.slice(index,index+query.length);fragment.append(mark);offset=index+query.length;index=lower.indexOf(query,offset)}fragment.append(document.createTextNode(source.slice(offset)));node.replaceWith(fragment)}};
  const updateSearch=()=>{clearMarks();const query=searchInput.value.trim().toLocaleLowerCase();body.classList.toggle('searching',Boolean(query));matches=[];current=-1;if(query){for(const message of messages){const content=message.querySelector('.message-content');if(content&&content.textContent.toLocaleLowerCase().includes(query)){message.classList.add('search-hit');matches.push(message);markText(content,query)}}}searchCount.textContent=matches.length?'1 / '+matches.length:'0 / 0';if(matches.length){current=0;matches[0].classList.add('search-hit-current')}};
  const go=(delta)=>{if(!matches.length)return;matches[current]?.classList.remove('search-hit-current');current=(current+delta+matches.length)%matches.length;matches[current].classList.add('search-hit-current');matches[current].scrollIntoView({behavior:'smooth',block:'center'});searchCount.textContent=(current+1)+' / '+matches.length};
  const openSearch=()=>{searchPanel.classList.add('open');setTimeout(()=>searchInput.focus(),0)};
  document.getElementById('search-toggle').addEventListener('click',()=>{searchPanel.classList.toggle('open');if(searchPanel.classList.contains('open'))searchInput.focus()});
  searchInput.addEventListener('input',updateSearch);searchInput.addEventListener('keydown',(event)=>{if(event.key==='Enter'){event.preventDefault();go(event.shiftKey?-1:1)}if(event.key==='Escape'){searchInput.value='';updateSearch();searchPanel.classList.remove('open')}});
  document.getElementById('search-next').addEventListener('click',()=>go(1));document.getElementById('search-prev').addEventListener('click',()=>go(-1));
  document.addEventListener('keydown',(event)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openSearch()}else if(event.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){event.preventDefault();openSearch()}});
  const readTheme=()=>{try{return localStorage.getItem('contextvault-html-theme')||'auto'}catch{return 'auto'}};const setTheme=(theme)=>{root.dataset.theme=theme;try{localStorage.setItem('contextvault-html-theme',theme)}catch{}};setTheme(readTheme());document.getElementById('theme-toggle').addEventListener('click',()=>setTheme(root.dataset.theme==='auto'?'dark':root.dataset.theme==='dark'?'light':'auto'));
  const toggleToc=(open)=>body.classList.toggle('toc-open',open);document.getElementById('toc-toggle').addEventListener('click',()=>toggleToc(!body.classList.contains('toc-open')));document.getElementById('toc-backdrop').addEventListener('click',()=>toggleToc(false));tocLinks.forEach(link=>link.addEventListener('click',()=>toggleToc(false)));
  const byId=new Map(tocLinks.map(link=>[link.dataset.target,link]));const activateToc=(targetId)=>{const active=byId.get(targetId);if(!active)return;tocLinks.forEach(link=>link.classList.toggle('active',link===active));active.scrollIntoView({block:'nearest'})};if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{const visible=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)[0];if(visible)activateToc(visible.target.dataset.tocTarget||visible.target.id)},{rootMargin:'-20% 0px -68% 0px',threshold:[0,.1,1]});messages.forEach(message=>observer.observe(message))}else{window.addEventListener('scroll',()=>{const current=[...messages].reverse().find(message=>message.getBoundingClientRect().top<window.innerHeight*.36)||messages[0];if(current)activateToc(current.dataset.tocTarget||current.id)},{passive:true})}if(tocLinks[0])tocLinks[0].classList.add('active');
})();
</script>
</body>
</html>`;
}
