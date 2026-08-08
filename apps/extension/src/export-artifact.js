import { createStoredZip } from "./zip.js";

const encoder = new TextEncoder();
const PLATFORM_SUFFIX = /\s*[-–—|·]\s*(?:ChatGPT|OpenAI|Claude|Gemini|DeepSeek|Kimi|豆包)\s*$/i;
const GENERIC_TITLES = [
  /^(?:chatgpt|openai|claude|gemini|deepseek|kimi|豆包)$/i,
  /^(?:untitled conversation|new chat|chatgpt conversation|ai conversation)$/i,
  /^(?:未命名对话|新对话|网页\s*ai\s*对话|ai\s*对话|当前\s*ai\s*对话)$/i,
];
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function cleanText(value) {
  return typeof value === "string"
    ? value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
    : "";
}

function meaningfulTitle(value) {
  const text = cleanText(value).replace(PLATFORM_SUFFIX, "").trim();
  if (!text || GENERIC_TITLES.some((pattern) => pattern.test(text))) return null;
  return text;
}

function firstUserMessageTitle(canonical) {
  const activePath = Array.isArray(canonical?.activePath) ? canonical.activePath : [];
  const nodes = canonical?.nodes && typeof canonical.nodes === "object" ? canonical.nodes : {};
  for (const nodeId of activePath) {
    const node = nodes[nodeId];
    if (!node || node.role !== "user") continue;
    const text = (Array.isArray(node.content) ? node.content : [])
      .map((part) => cleanText(part?.text))
      .filter(Boolean)
      .join(" ")
      .replace(/^#{1,6}\s*/, "")
      .replace(/^```[^\n]*\s*/, "")
      .replace(/```.*$/s, "")
      .trim();
    if (!text) continue;
    const firstSentence = text.split(/(?<=[。！？!?])\s+|\n+/u)[0] || text;
    return meaningfulTitle(firstSentence.slice(0, 64));
  }
  return null;
}

export function resolveExportTitle({ canonical, raw, tabTitle, providerDisplayName = "AI" } = {}) {
  const rawRecord = raw && typeof raw === "object" ? raw : {};
  const rawConversation = rawRecord?.conversation && typeof rawRecord.conversation === "object" ? rawRecord.conversation : {};
  const rawMetadata = rawRecord?.metadata && typeof rawRecord.metadata === "object" ? rawRecord.metadata : {};
  const candidates = [
    canonical?.title,
    rawRecord.title,
    rawConversation.title,
    canonical?.metadata?.pageTitle,
    rawRecord.pageTitle,
    rawMetadata.title,
    tabTitle,
  ];
  for (const candidate of candidates) {
    const title = meaningfulTitle(candidate);
    if (title) return title;
  }
  const promptTitle = firstUserMessageTitle(canonical);
  if (promptTitle) return promptTitle;
  const shortId = cleanText(canonical?.conversationId).replace(/[^a-z0-9_-]/gi, "").slice(0, 12);
  return `${cleanText(providerDisplayName) || "AI"} 对话${shortId ? `-${shortId}` : ""}`;
}

export function safeExportName(value) {
  let result = String(value || "AI 对话")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 96)
    .replace(/[. ]+$/g, "");
  if (!result) result = "AI 对话";
  if (WINDOWS_RESERVED_NAME.test(result)) result = `_${result}`;
  return result;
}

export function buildExportArtifact({ format, title, raw, canonical, report, markdown, html, technicalMarkdown = markdown, technicalHtml = html, includeTechnicalEvidence = false }) {
  const base = safeExportName(title);
  if (format === "markdown") {
    return {
      filename: `${base}.md`,
      mimeType: "text/markdown;charset=utf-8",
      bytes: encoder.encode(markdown),
    };
  }
  if (format === "backup-zip") {
    return {
      filename: `${base}-KV-Archive.zip`,
      mimeType: "application/zip",
      bytes: createStoredZip([
        { name: "README.txt", data: includeTechnicalEvidence
          ? "这是 KV Archive 当前对话技术备份包。conversation.html 中的正式回答默认展开，工具与推理摘要默认折叠。\ntechnical-evidence.html、technical-evidence.md、raw.json 与 canonical.json 仅用于审计、排错与技术复现。\n"
          : "这是 KV Archive 当前对话精简备份包。日常阅读或交给 Agent 时，请优先打开 conversation.html 或 conversation.md。\n本包默认不包含工具调用链路、工具结果、推理摘要和原始技术证据。\n" },
        { name: "conversation.html", data: html },
        { name: "conversation.md", data: markdown },
        ...(includeTechnicalEvidence ? [
          { name: "technical-evidence.html", data: technicalHtml },
          { name: "technical-evidence.md", data: technicalMarkdown },
          { name: "raw.json", data: JSON.stringify(raw, null, 2) + "\n" },
          { name: "canonical.json", data: JSON.stringify(canonical, null, 2) + "\n" },
        ] : []),
        { name: "integrity-report.json", data: JSON.stringify(report, null, 2) + "\n" },
      ]),
    };
  }
  return {
    filename: `${base}.html`,
    mimeType: "text/html;charset=utf-8",
    bytes: encoder.encode(html),
  };
}
