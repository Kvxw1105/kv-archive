import assert from "node:assert/strict";
import test from "node:test";
import { buildExportArtifact, resolveExportTitle, safeExportName } from "../apps/extension/src/export-artifact.js";
import { readZipEntries } from "../apps/extension/src/zip-reader.js";

const base = {
  title: "A/B Test",
  raw: { id: "1" },
  canonical: { conversationId: "1" },
  report: { status: "COMPLETE" },
  markdown: "# Readable\n",
  html: "<!doctype html><title>Readable</title>",
  technicalMarkdown: "# Technical\nTool call",
  technicalHtml: "<!doctype html><title>Technical</title><p>Tool call</p>",
};

test("every export mode produces exactly one user-facing artifact", () => {
  const html = buildExportArtifact({ ...base, format: "readable-html" });
  const markdown = buildExportArtifact({ ...base, format: "markdown" });
  const backup = buildExportArtifact({ ...base, format: "backup-zip" });
  assert.equal(html.filename, "A-B Test.html");
  assert.equal(markdown.filename, "A-B Test.md");
  assert.equal(backup.filename, "A-B Test-KV-Archive.zip");
  for (const artifact of [html, markdown, backup]) assert.ok(artifact.bytes.length > 0);
});

test("backup ZIP excludes technical evidence by default", async () => {
  const backup = buildExportArtifact({ ...base, format: "backup-zip" });
  const entries = await readZipEntries(backup.bytes);
  for (const path of ["README.txt", "conversation.html", "conversation.md", "integrity-report.json"]) {
    assert(entries.has(path), `missing ${path}`);
  }
  for (const path of ["technical-evidence.html", "technical-evidence.md", "raw.json", "canonical.json"]) {
    assert.equal(entries.has(path), false, `unexpected ${path}`);
  }
  const decoder = new TextDecoder();
  assert.match(decoder.decode(entries.get("conversation.md")), /Readable/);
  assert.doesNotMatch(decoder.decode(entries.get("conversation.md")), /Tool call/);
  assert.match(decoder.decode(entries.get("README.txt")), /默认不包含工具调用链路/);
});

test("technical backup ZIP includes opt-in evidence files", async () => {
  const backup = buildExportArtifact({ ...base, format: "backup-zip", includeTechnicalEvidence: true });
  const entries = await readZipEntries(backup.bytes);
  for (const path of [
    "README.txt",
    "conversation.html",
    "conversation.md",
    "technical-evidence.html",
    "technical-evidence.md",
    "raw.json",
    "canonical.json",
    "integrity-report.json",
  ]) assert(entries.has(path), `missing ${path}`);
  const decoder = new TextDecoder();
  assert.match(decoder.decode(entries.get("technical-evidence.md")), /Tool call/);
  assert.match(decoder.decode(entries.get("README.txt")), /工具与推理摘要默认折叠/);
});

test("export filename prefers the real conversation title and removes provider suffixes", () => {
  const canonical = { conversationId: "c-1", title: "ChatGPT", activePath: [], nodes: {}, metadata: {} };
  assert.equal(resolveExportTitle({ canonical, raw: {}, tabTitle: "VectCutAPI 开源项目分析 - ChatGPT" }), "VectCutAPI 开源项目分析");
  const artifact = buildExportArtifact({ ...base, canonical, title: resolveExportTitle({ canonical, raw: {}, tabTitle: "VectCutAPI 开源项目分析 - ChatGPT" }), format: "readable-html" });
  assert.equal(artifact.filename, "VectCutAPI 开源项目分析.html");
});

test("export filename falls back to the first user message when provider titles are generic", () => {
  const canonical = {
    conversationId: "c-2",
    title: "网页 AI 对话",
    activePath: ["u1", "a1"],
    nodes: {
      u1: { role: "user", content: [{ type: "text", text: "帮我分析这个开源项目到底有什么门道" }] },
      a1: { role: "assistant", content: [{ type: "text", text: "好的" }] },
    },
    metadata: { pageTitle: "ChatGPT" },
  };
  assert.equal(resolveExportTitle({ canonical, raw: {}, tabTitle: "ChatGPT" }), "帮我分析这个开源项目到底有什么门道");
});

test("safe export names remain portable on Windows", () => {
  assert.equal(safeExportName('A/B: C*D? "E".'), "A-B- C-D- -E-");
  assert.equal(safeExportName("CON"), "_CON");
  assert.equal(safeExportName("标题...   "), "标题");
});
