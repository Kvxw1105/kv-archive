import { sha256Hex, scoreSearchResult } from "./vault-index.js";
import { createStoredZip } from "./zip.js";

const encoder = new TextEncoder();

function clean(value, max = 20000) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
}

function unique(values = []) {
  return [...new Set(values.map((value) => clean(value, 4000)).filter(Boolean))];
}

function dateValue(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function estimateMemoryTokens(text) {
  const value = String(text || "");
  let cjk = 0;
  let other = 0;
  for (const char of value) {
    if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(char)) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4);
}

function evidenceUri(message) {
  if (!message?.conversationId || !message?.nodeId || !message?.evidenceHash) return null;
  return `contextvault://conversation/${encodeURIComponent(message.conversationId)}/node/${encodeURIComponent(message.nodeId)}?evidence=${encodeURIComponent(message.evidenceHash)}`;
}


function contentEvidenceUri(item) {
  if (!item?.id || !item?.revision || !item?.contentHash) return null;
  return `contextvault://content/${encodeURIComponent(item.id)}?revision=${encodeURIComponent(item.revision)}&hash=${encodeURIComponent(item.contentHash)}`;
}

function contentSearchText(item) {
  return [item?.title, item?.body, ...(item?.tags || [])].map((value) => clean(value, 20000)).join("\n").toLowerCase();
}

function selectContent(records, options = {}) {
  const query = clean(options.query, 2000).toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);
  return (records.contentObjects || [])
    .filter((item) => item.status !== "trashed")
    .map((item) => {
      const text = contentSearchText(item);
      const score = query ? tokens.reduce((total, token) => total + (text.includes(token) ? 1 : 0), 0) : 0;
      return { item, score };
    })
    .filter((entry) => !query || entry.score > 0)
    .sort((a, b) => (query ? b.score - a.score : 0)
      || dateValue(b.item.updatedAt || b.item.createdAt) - dateValue(a.item.updatedAt || a.item.createdAt)
      || String(a.item.id).localeCompare(String(b.item.id)));
}

function renderContentEvidence(entries, heading, budgetTokens, baseText) {
  const lines = [`## ${heading}`, ""];
  const sources = [];
  let current = baseText + lines.join("\n");
  for (const { item } of entries) {
    const uri = contentEvidenceUri(item);
    const block = [
      `### ${clean(item.title, 300) || "未命名记录"}`,
      "",
      `- 类型：${clean(item.kind, 100) || "note"}`,
      `- 状态：${clean(item.status, 100) || "active"}`,
      `- 更新时间：${clean(item.updatedAt || item.createdAt) || "未知"}`,
      item.tags?.length ? `- 标签：${item.tags.map((tag) => clean(tag, 100)).filter(Boolean).join("、")}` : "",
      uri ? `- 证据：${uri}` : "",
      "",
      clean(item.body, 2400) || "（无正文）",
      "",
    ].filter(Boolean).join("\n");
    if (estimateMemoryTokens(current + block) > budgetTokens) break;
    lines.push(block);
    current += block;
    if (uri) sources.push(uri);
  }
  if (lines.length === 2) lines.push("暂无匹配记录。\n");
  return { markdown: lines.join("\n"), sources };
}

function listSection(title, rows, empty = "暂无") {
  return [`## ${title}`, "", ...(rows.length ? rows.map((row) => `- ${row}`) : [`- ${empty}`]), ""].join("\n");
}

function activeDecisions(state) {
  return (state?.decisions || []).filter((item) => item.status !== "superseded");
}

function activeTasks(state) {
  return (state?.tasks || []).filter((item) => !["done", "cancelled", "superseded"].includes(item.status));
}

function renderCoreMemory(state, generatedAt) {
  const status = state?.status || {};
  const decisions = activeDecisions(state).slice(0, 30).map((item) => {
    const suffix = item.summary ? `：${clean(item.summary, 800)}` : "";
    return `${item.title}${suffix}`;
  });
  const tasks = activeTasks(state).slice(0, 30).map((item) => {
    const meta = [item.status, item.priority, item.owner].filter(Boolean).join(" / ");
    return `${item.title}${meta ? `（${meta}）` : ""}${item.notes ? `：${clean(item.notes, 800)}` : ""}`;
  });
  const blockers = unique(status.blockers).slice(0, 30);
  const nextActions = unique(status.nextActions).slice(0, 30);
  const evidence = unique([
    ...activeDecisions(state).flatMap((item) => item.evidenceUris || []),
    ...activeTasks(state).flatMap((item) => item.evidenceUris || []),
  ]).slice(0, 100);
  return [
    `# ${clean(state?.projectTitle || state?.projectId || "项目")} · 核心记忆`,
    "",
    `> 由 ContextVault 从已批准项目状态生成。状态版本 v${Number(state?.stateVersion || 0)}，状态更新时间 ${clean(state?.updatedAt) || "未记录"}。`,
    "",
    "## 项目状态",
    "",
    `- 阶段：${clean(status.phase) || "未设置"}`,
    `- 健康度：${clean(status.health) || "unknown"}`,
    `- 进度：${Number(status.progressPercent || 0)}%`,
    `- 摘要：${clean(status.summary, 3000) || "暂无"}`,
    "",
    listSection("阻塞事项", blockers),
    listSection("下一步", nextActions),
    listSection("有效决策", decisions),
    listSection("进行中任务", tasks),
    listSection("证据索引", evidence, "暂无已批准证据"),
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function selectMessages(records, options) {
  const query = clean(options.query, 2000);
  const conversations = new Map((records.conversations || []).map((row) => [row.key, row]));
  const active = (records.messages || []).filter((message) => message.activePath !== false && conversations.has(message.conversationKey));
  const scored = active.map((message) => {
    const conversation = conversations.get(message.conversationKey);
    const score = query ? scoreSearchResult(message, query) : 0;
    return { message, conversation, score };
  }).filter((item) => !query || item.score > 0);
  scored.sort((a, b) => {
    if (query && b.score !== a.score) return b.score - a.score;
    return dateValue(b.message.createdAt || b.conversation.updatedAt) - dateValue(a.message.createdAt || a.conversation.updatedAt)
      || String(a.message.key).localeCompare(String(b.message.key));
  });
  return scored;
}

function renderEvidenceMessages(items, heading, budgetTokens, baseText) {
  const lines = [`## ${heading}`, ""];
  const sources = [];
  let current = baseText + lines.join("\n");
  for (const item of items) {
    const uri = evidenceUri(item.message);
    const role = item.message.role === "user" ? "用户" : item.message.role === "assistant" ? "ChatGPT" : item.message.role;
    const excerpt = clean(item.message.text, 1800);
    const block = [
      `### ${clean(item.conversation.title, 300)}`,
      "",
      `- 角色：${role}`,
      `- 时间：${clean(item.message.createdAt || item.conversation.updatedAt) || "未知"}`,
      uri ? `- 证据：${uri}` : "",
      "",
      excerpt,
      "",
    ].filter(Boolean).join("\n");
    if (estimateMemoryTokens(current + block) > budgetTokens) break;
    lines.push(block);
    current += block;
    if (uri) sources.push(uri);
  }
  if (lines.length === 2) lines.push("暂无匹配证据。\n");
  return { markdown: lines.join("\n"), sources };
}

export async function buildMemoryPackage(records, options = {}) {
  const mode = ["core", "project", "task"].includes(options.mode) ? options.mode : "core";
  const projectId = clean(options.projectId || records.states?.[0]?.projectId, 300);
  if (!projectId) throw new Error("请选择 Project");
  const state = (records.states || []).find((item) => item.projectId === projectId);
  if (!state) throw new Error("当前 Project 没有可用的批准状态");
  const generatedAt = options.generatedAt || new Date().toISOString();
  const budgetTokens = Math.max(512, Math.floor(Number(options.budgetTokens || (mode === "task" ? 2048 : 8192))));
  const core = renderCoreMemory(state, generatedAt);
  let markdown = core;
  let sources = unique([
    ...activeDecisions(state).flatMap((item) => item.evidenceUris || []),
    ...activeTasks(state).flatMap((item) => item.evidenceUris || []),
  ]);
  if (mode === "project") {
    const content = renderContentEvidence(selectContent(records, { query: "" }), "项目记录", budgetTokens, markdown);
    markdown = `${markdown}
${content.markdown}`;
    sources = unique([...sources, ...content.sources]);
    const messages = renderEvidenceMessages(selectMessages(records, { query: "" }), "最近对话证据", budgetTokens, markdown);
    markdown = `${markdown}
${messages.markdown}`;
    sources = unique([...sources, ...messages.sources]);
  } else if (mode === "task") {
    const query = clean(options.query, 2000);
    if (!query) throw new Error("任务上下文需要填写任务或问题");
    markdown = `${core}
## 当前任务

${query}

`;
    const content = renderContentEvidence(selectContent(records, { query }), "相关项目记录", budgetTokens, markdown);
    markdown = `${markdown}${content.markdown}`;
    sources = unique([...sources, ...content.sources]);
    const messages = renderEvidenceMessages(selectMessages(records, { query }), "相关对话证据", budgetTokens, markdown);
    markdown = `${markdown}
${messages.markdown}`;
    sources = unique([...sources, ...messages.sources]);
  }
  while (estimateMemoryTokens(markdown) > budgetTokens && markdown.length > 500) markdown = `${markdown.slice(0, Math.floor(markdown.length * 0.94)).trim()}\n\n> 已按预算截断。\n`;
  const hash = await sha256Hex({ mode, projectId, stateVersion: state.stateVersion, markdown, sources });
  return {
    format: "context-vault-memory-package",
    schemaVersion: 1,
    id: `memory:${projectId}:${mode}:${hash.slice(0, 16)}`,
    projectId,
    projectTitle: state.projectTitle || projectId,
    mode,
    query: clean(options.query, 2000),
    generatedAt,
    budgetTokens,
    estimatedTokens: estimateMemoryTokens(markdown),
    sourceStateVersion: state.stateVersion || 0,
    sourceStateHash: state.stateHash || null,
    sources,
    hash,
    markdown,
  };
}

export function diffMemoryMarkdown(before = "", after = "") {
  const left = String(before || "").split("\n");
  const right = String(after || "").split("\n");
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const removed = left.filter((line) => line.trim() && !rightSet.has(line));
  const added = right.filter((line) => line.trim() && !leftSet.has(line));
  return { added, removed, changed: added.length + removed.length };
}

export function buildMemoryBundle(profile) {
  if (!profile?.projectId || !profile?.core?.markdown) throw new Error("没有已批准的 Project 记忆");
  const evidence = unique([...(profile.core.sources || []), ...(profile.project?.sources || [])]);
  const manifest = {
    format: "context-vault-memory-bundle",
    version: 1,
    projectId: profile.projectId,
    projectTitle: profile.projectTitle,
    memoryVersion: profile.version,
    memoryHash: profile.hash,
    approvedAt: profile.approvedAt,
    files: ["00_CORE_MEMORY.md", "01_PROJECT_MEMORY.md", "02_EVIDENCE_INDEX.md"],
  };
  const entries = [
    { name: "manifest.json", data: `${JSON.stringify(manifest, null, 2)}\n` },
    { name: "00_CORE_MEMORY.md", data: profile.core.markdown },
    { name: "01_PROJECT_MEMORY.md", data: profile.project?.markdown || profile.core.markdown },
    { name: "02_EVIDENCE_INDEX.md", data: `# Evidence Index\n\n${evidence.map((uri) => `- ${uri}`).join("\n") || "- No evidence URI"}\n` },
  ];
  return {
    filename: `ContextVault-${profile.projectTitle.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 80) || "Project"}-Memory-v${profile.version}.zip`,
    bytes: createStoredZip(entries.map((entry) => ({ name: entry.name, data: encoder.encode(entry.data) }))),
    manifest,
  };
}
