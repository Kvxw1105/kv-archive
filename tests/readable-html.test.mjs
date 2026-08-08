import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { normalizeChatGPTConversation } from "../dist/packages/normalizer/src/index.js";
import { getActivePathRenderDiagnostics, renderActivePathMarkdown, renderReadableHtml } from "../dist/packages/renderers/src/index.js";

const fixture = JSON.parse(await readFile("fixtures/synthetic/multi-branch-conversation.json", "utf8"));

function technicalConversation() {
  const baseNode = (nodeId, role, content, parentId = null) => ({
    nodeId,
    parentId,
    childrenIds: [],
    messageId: `message-${nodeId}`,
    role,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    content,
    model: null,
    status: "finished_successfully",
    metadata: {},
    rawPayload: {},
  });
  const nodes = {
    user: baseNode("user", "user", [{ type: "text", text: "请生成安装包。", rawPayload: {} }]),
    assistant: baseNode("assistant", "assistant", [
      { type: "text", text: "已经生成可下载文件。", rawPayload: {} },
      { type: "tool_call", text: "internal.tool({ secret: true })", rawPayload: { internal: true } },
    ], "user"),
    tool: baseNode("tool", "tool", [{
      type: "tool_result",
      text: "opaque tool JSON that should stay out of the reading view",
      rawPayload: {
        file_name: "kv-archive.zip",
        download_url: "https://files.example/kv-archive.zip?expires=123&signature=abc",
      },
    }], "assistant"),
    reasoning: baseNode("reasoning", "assistant", [{
      type: "reasoning_summary",
      text: "private intermediate hypothesis",
      rawPayload: {},
    }], "tool"),
    unknown: baseNode("unknown", "assistant", [{
      type: "unknown",
      sourceType: "future_internal_event",
      text: "unreadable internal node",
      rawPayload: {},
    }], "reasoning"),
  };
  nodes.user.childrenIds = ["assistant"];
  nodes.assistant.childrenIds = ["tool"];
  nodes.tool.childrenIds = ["reasoning"];
  nodes.reasoning.childrenIds = ["unknown"];
  return {
    schemaVersion: "0.1",
    conversationId: "conversation-readable-test",
    title: "Readable export test",
    source: {
      provider: "chatgpt",
      adapter: "test",
      sourceUrl: "https://chatgpt.com/c/conversation-readable-test",
    },
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    currentNodeId: "unknown",
    nodes,
    edges: [
      { from: "user", to: "assistant" },
      { from: "assistant", to: "tool" },
      { from: "tool", to: "reasoning" },
      { from: "reasoning", to: "unknown" },
    ],
    activePath: ["user", "assistant", "tool", "reasoning", "unknown"],
    projectId: null,
    metadata: {},
    rawMetadata: {},
  };
}

test("readable HTML mirrors ChatGPT while preserving independent evidence data", () => {
  const canonical = normalizeChatGPTConversation(fixture);
  const html = renderReadableHtml(canonical, { integrityStatus: "PARTIAL" });
  assert.match(html, /ContextVault Synthetic Branch Test/);
  assert.match(html, />你</);
  assert.match(html, />ChatGPT</);
  assert.match(html, /CHATGPT 对话镜像/);
  assert.match(html, /class="message user"/);
  assert.match(html, /class="message assistant"/);
  assert.match(html, /message-bubble|message\.user \.message-content/);
  assert.match(html, /完整性：可能不完整/);
  assert.doesNotMatch(html, /"rawPayload"\s*:/);
});

test("readable HTML includes a floating scroll directory and in-page search navigation", () => {
  const canonical = normalizeChatGPTConversation(fixture);
  const html = renderReadableHtml(canonical, { integrityStatus: "COMPLETE" });
  assert.match(html, /id="conversation-toc"/);
  assert.match(html, /滚动悬浮目录/);
  assert.match(html, /class="toc-link"/);
  assert.match(html, /id="search-input"/);
  assert.match(html, /上一处/);
  assert.match(html, /下一处/);
  assert.match(html, /IntersectionObserver/);
  assert.match(html, /data-copy-message/);
  assert.match(html, /data-copy-code/);
});

test("default HTML exports only user prompts and assistant final answers", () => {
  const canonical = technicalConversation();
  const readableHtml = renderReadableHtml(canonical, { integrityStatus: "COMPLETE" });
  const assistantHtml = renderReadableHtml(canonical, { integrityStatus: "COMPLETE", mode: "assistant-only" });
  const technicalHtml = renderReadableHtml(canonical, { integrityStatus: "COMPLETE", mode: "technical" });
  const readableMarkdown = renderActivePathMarkdown(canonical);
  const assistantMarkdown = renderActivePathMarkdown(canonical, { mode: "assistant-only" });
  const technicalMarkdown = renderActivePathMarkdown(canonical, { mode: "technical" });

  assert.match(readableHtml, /请生成安装包/);
  assert.match(readableHtml, /已经生成可下载文件/);
  assert.match(readableHtml, /内容：精简对话/);
  assert.doesNotMatch(readableHtml, /kv-archive\.zip|internal\.tool|private intermediate hypothesis|unreadable internal node|opaque tool JSON/);
  assert.doesNotMatch(readableMarkdown, /Tool call|Tool result|Reasoning summary|Unsupported content|kv-archive\.zip/);

  assert.doesNotMatch(assistantHtml, /请生成安装包/);
  assert.match(assistantHtml, /已经生成可下载文件/);
  assert.match(assistantHtml, /内容：仅 AI 正式回答/);
  assert.doesNotMatch(assistantMarkdown, /请生成安装包|Tool call|Tool result|Reasoning summary/);

  assert.match(technicalHtml, /工具调用/);
  assert.match(technicalHtml, /internal\.tool/);
  assert.match(technicalHtml, /工具结果/);
  assert.match(technicalHtml, /kv-archive\.zip/);
  assert.match(technicalHtml, /推理摘要/);
  assert.match(technicalHtml, /private intermediate hypothesis/);
  assert.match(technicalHtml, /未识别内容/);
  assert.match(technicalHtml, /内容：完整技术记录/);
  assert.doesNotMatch(technicalHtml, /<details[^>]*open/);
  assert.match(technicalMarkdown, /Tool call: internal\.tool/);
  assert.match(technicalMarkdown, /Tool result: opaque tool JSON/);
  assert.match(technicalMarkdown, /Reasoning summary: private intermediate hypothesis/);
  assert.match(technicalMarkdown, /Unsupported content: future_internal_event/);
});


function rawSemanticConversation() {
  const mapping = {};
  const add = (id, parent, role, text, extras = {}) => {
    mapping[id] = {
      parent,
      children: [],
      message: {
        id: `message-${id}`,
        author: { role, name: extras.authorName ?? null },
        content: { content_type: extras.contentType ?? "text", parts: [text] },
        metadata: extras.metadata ?? {},
        recipient: extras.recipient,
        channel: extras.channel,
        status: extras.status ?? "finished_successfully",
        create_time: 1,
      },
    };
    if (parent) mapping[parent].children.push(id);
  };
  add("user", null, "user", "真实用户问题");
  add("commentary", "user", "assistant", "我先处理一下。", { channel: "commentary" });
  add("skill", "commentary", "assistant", '{"paths":["skills', { recipient: "api_tool" });
  add("tool", "skill", "tool", '{"result":"internal"}');
  add("reasoning", "tool", "assistant", "中间推理", { channel: "analysis" });
  add("final", "reasoning", "assistant", "这是最终正式回答。");
  return {
    id: "semantic-regression",
    title: "Semantic regression",
    current_node: "final",
    mapping,
  };
}

test("compact mode excludes assistant-authored tool dispatch, commentary and reasoning", () => {
  const canonical = normalizeChatGPTConversation(rawSemanticConversation());
  const compactHtml = renderReadableHtml(canonical, { integrityStatus: "COMPLETE" });
  const compactMarkdown = renderActivePathMarkdown(canonical);
  const technicalHtml = renderReadableHtml(canonical, { integrityStatus: "COMPLETE", mode: "technical" });

  assert.match(compactHtml, /真实用户问题/);
  assert.match(compactHtml, /这是最终正式回答/);
  assert.doesNotMatch(compactHtml, /我先处理一下|paths|internal|中间推理/);
  assert.doesNotMatch(compactMarkdown, /我先处理一下|paths|internal|中间推理/);
  assert.match(technicalHtml, /中间过程/);
  assert.match(technicalHtml, /工具调用/);
  assert.match(technicalHtml, /工具结果/);
  assert.match(technicalHtml, /推理摘要/);
  assert.doesNotMatch(technicalHtml, /<details[^>]*open/);
});

test("streaming fragments with one stable message identity render as one completed answer", () => {
  const base = technicalConversation();
  base.nodes = {
    user: { ...base.nodes.user, childrenIds: ["delta-1"] },
    "delta-1": {
      ...base.nodes.assistant,
      nodeId: "delta-1",
      parentId: "user",
      childrenIds: ["delta-2"],
      messageId: "stream-message",
      streamGroupId: "stream-message",
      semanticType: "assistant_final",
      content: [{ type: "text", text: "完整", rawPayload: {} }],
    },
    "delta-2": {
      ...base.nodes.assistant,
      nodeId: "delta-2",
      parentId: "delta-1",
      childrenIds: [],
      messageId: "stream-message",
      streamGroupId: "stream-message",
      semanticType: "assistant_final",
      content: [{ type: "text", text: "完整回答", rawPayload: {} }],
    },
  };
  base.currentNodeId = "delta-2";
  base.activePath = ["user", "delta-1", "delta-2"];
  const html = renderReadableHtml(base, { integrityStatus: "COMPLETE" });
  const markdown = renderActivePathMarkdown(base);
  assert.equal((html.match(/data-semantic-type="assistant_final"/g) ?? []).length, 1);
  assert.equal((html.match(/完整回答/g) ?? []).length, 1);
  assert.doesNotMatch(html, />完整<\/p>.*>完整回答<\/p>/s);
  assert.equal((markdown.match(/## 2\. Assistant/g) ?? []).length, 1);
});


test("partial readable HTML exposes A-to-D export diagnostics", () => {
  const canonical = normalizeChatGPTConversation(fixture);
  const render = getActivePathRenderDiagnostics(canonical, { mode: "conversation" });
  const html = renderReadableHtml(canonical, {
    integrityStatus: "PARTIAL",
    mode: "conversation",
    diagnostics: {
      rawSourceNodes: 120,
      parentTraceNodes: 100,
      normalizedMessages: canonical.activePath.length,
      exportedMessages: render.renderedMessages,
      captureAdapter: "chatgpt-dom-history-hydrator",
    },
  });
  assert.match(html, /导出诊断（A → D）/);
  assert.match(html, /A · 原始来源节点/);
  assert.match(html, />120</);
  assert.match(html, /B · 父链／页面累积/);
  assert.match(html, /chatgpt-dom-history-hydrator/);
});
