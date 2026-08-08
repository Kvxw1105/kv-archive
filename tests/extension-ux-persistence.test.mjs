import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("conversation basket restores cached catalog and auto-saves selection changes", async () => {
  const source = await readFile("apps/extension/src/basket.js", "utf8");
  const html = await readFile("apps/extension/src/basket.html", "utf8");
  assert.match(source, /catalogStore\.getLatest\("chatgpt"\)/);
  assert.match(source, /selectionStore\.list\(\)/);
  assert.match(source, /scheduleSelectionSave\(\)/);
  assert.match(source, /已恢复上次会话目录/);
  assert.match(source, /刷新失败，仍保留本地缓存/);
  assert.match(html, /会话目录与选择集自动保存在浏览器中/);
  assert.match(html, /立即保存/);
});

test("conversation basket separates capture from local export and supports resumable large batches", async () => {
  const source = await readFile("apps/extension/src/basket.js", "utf8");
  const html = await readFile("apps/extension/src/basket.html", "utf8");
  for (const id of ["pause-capture", "export-saved", "saved-count", "remaining-count", "failed-count", "load-more-conversations"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /先把会话采集并持续保存到浏览器，再把任意已保存成果导出为本地 ZIP/);
  assert.match(source, /control: captureControl/);
  assert.match(source, /pendingExportAfterPause = true/);
  assert.match(source, /createSavedHistoryExportSnapshot/);
  assert.match(source, /CATALOG_RENDER_BATCH = 180/);
  assert.match(source, /SELECTION_PREVIEW_LIMIT = 80/);
  assert.doesNotMatch(source, /采集完成，正在规划低内存分卷/);
});

test("popup navigation uses the reusable workspace navigator", async () => {
  const source = await readFile("apps/extension/src/popup.js", "utf8");
  assert.match(source, /openWorkspacePage\(chrome, file\)/);
  assert.doesNotMatch(source, /async function openExtensionPage\(file\) \{\s*await chrome\.tabs\.create/);
});

test("memory surface explains Project scope and no longer claims official memory sync", async () => {
  const html = await readFile("apps/extension/src/memory.html", "utf8");
  const source = await readFile("apps/extension/src/memory.js", "utf8");
  assert.match(html, /<h1>项目上下文<\/h1>/);
  assert.match(html, /这不是 ChatGPT 官方“记忆同步”/);
  assert.match(html, /Project 就是本地工作范围/);
  assert.match(html, /工作范围（Project）/);
  assert.match(source, /PROJECT_PREF_KEY/);
  assert.match(source, /projects\.length===1\?projects\[0\]\.id/);
  assert.match(source, /localStorage\.setItem\(PROJECT_PREF_KEY/);
});

test("internal workspace transitions stay in the current tab", async () => {
  const backupSource = await readFile("apps/extension/src/backup.js", "utf8");
  assert.match(backupSource, /window\.location\.assign\(chrome\.runtime\.getURL\("library\.html"\)\)/);
  assert.doesNotMatch(backupSource, /chrome\.tabs\.create\(\{ url: chrome\.runtime\.getURL\("library\.html"\)/);
});
