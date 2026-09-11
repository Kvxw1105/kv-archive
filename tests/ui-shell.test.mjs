import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pages = ["backup", "basket", "library", "state", "memory", "knowledge"];

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

test("KV Archive full-page surfaces share one accessible application shell", async () => {
  for (const page of pages) {
    const html = await readFile(`apps/extension/src/${page}.html`, "utf8");
    assert.match(html, /<title>KV Archive · /, `${page} should expose the KV Archive title`);
    assert.match(html, /href="ui\.css"/, `${page} should use the shared visual system`);
    assert.match(html, /class="app-frame"/, `${page} should use the application frame`);
    assert.match(html, /class="side-rail"/, `${page} should expose the shared navigation rail`);
    assert.equal(count(html, /aria-current="page"/g), 1, `${page} should identify exactly one active destination`);
    assert.doesNotMatch(html, /ContextVault|Context Fault|CONTEXTVAULT/, `${page} should not expose historical branding`);
  }
});

test("KV Archive popup and manifest expose the current product identity", async () => {
  const popup = await readFile("apps/extension/src/popup.html", "utf8");
  const manifest = JSON.parse(await readFile("apps/extension/src/manifest.json", "utf8"));
  assert.match(popup, /<title>KV Archive<\/title>/);
  assert.match(popup, /KV Archive/);
  assert.doesNotMatch(popup, /ContextVault|Context Fault|CONTEXTVAULT/);
  assert.match(popup, /id="content-mode"/);
  assert.match(popup, /精简对话：问题＋AI 正式回答/);
  assert.match(popup, /仅 AI 正式回答/);
  assert.match(popup, /完整技术记录：工具与推理摘要/);
  assert.match(popup, /id="next-step"/);
  assert.match(popup, /id="basket"/);
  assert.match(popup, /id="generic-capture"/);
  assert.match(popup, /id="save-library"[^>]*checked/);
  assert.match(popup, /id="download-file"/);
  assert.match(popup, /id="result-actions"/);
  assert.match(popup, /id="open-library"/);
  assert.match(popup, /id="show-download"/);
  assert.match(popup, /<script type="module" src="popup\.js"><\/script>/);
  assert.equal(manifest.name, "KV Archive");
  assert.equal(manifest.version, "0.16.11");
  assert.match(manifest.description, /local-first/i);
  assert.ok(Array.isArray(manifest.optional_host_permissions));
  assert.ok(manifest.optional_host_permissions.includes("https://gemini.google.com/*"));
});

test("backup center defaults manual runs to conversation-first attachment references", async () => {
  const html = await readFile("apps/extension/src/backup.html", "utf8");
  assert.match(html, /id="manual-assets"/);
  assert.match(html, /<option value="references-only">只备份对话，附件仅记录引用（推荐）<\/option>/);
  assert.match(html, /<option value="download">同时下载可访问附件<\/option>/);
});


test("advanced controls use progressive disclosure without removing core actions", async () => {
  const backup = await readFile("apps/extension/src/backup.html", "utf8");
  const knowledge = await readFile("apps/extension/src/knowledge.html", "utf8");
  assert.match(backup, /id="automatic-backup" class="card schedule-card schedule-primary"/);
  assert.match(backup, /<details id="schedule-settings"/);
  assert.match(backup, /<details class="schedule-tools"/);
  assert.match(backup, /class="action-more"/);
  assert.match(backup, /id="backup-health"/);
  assert.match(backup, /id="preflight-panel"/);
  assert.match(backup, /id="backup-recovery-actions"/);
  assert.match(backup, /class="card detailed-metrics"/);
  for (const id of ["start", "pause", "download", "library", "schedule-save", "reset"]) {
    assert.equal(count(backup, new RegExp(`id=["']${id}["']`, "g")), 1, `backup should preserve ${id}`);
  }
  assert.match(knowledge, /class="[^"]*\badvanced-options\b[^"]*"/);
  assert.match(knowledge, /id="copy-agent"/);
  assert.match(knowledge, /id="quality-verdict"/);
  assert.match(knowledge, /class="technical-quality"/);
  assert.match(knowledge, /全程本地处理 · 不消耗模型额度/);
  for (const id of ["project", "preview", "export", "copy-agent", "structure", "content", "asset-mode", "volume-size"]) {
    assert.equal(count(knowledge, new RegExp(`id=["']${id}["']`, "g")), 1, `knowledge should preserve ${id}`);
  }
});


test("Capture Center exposes portable dry-run recovery without weakening local-only boundaries", async () => {
  const html = await readFile("apps/extension/src/capture.html", "utf8");
  const source = await readFile("apps/extension/src/capture.js", "utf8");
  for (const id of ["export-portable", "import-portable-file", "analyze-portable", "apply-portable", "portable-plan", "recovery-receipts"]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /Dry-run first/);
  assert.match(html, /原始会话证据和已批准 Project State 不会被改写/);
  assert.match(source, /readPortableCaptureZip/);
  assert.match(source, /analyzePortablePackage/);
  assert.match(source, /rollbackPortableImport/);
});
