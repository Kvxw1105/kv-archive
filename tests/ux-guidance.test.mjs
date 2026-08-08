import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBackupPreflight,
  classifyRecoveryAction,
  deriveBackupHealth,
  derivePopupGuidance,
  summarizeKnowledgeQuality,
} from "../apps/extension/src/ux-guidance.js";

test("popup guidance prioritizes the next unfinished user job", () => {
  assert.equal(derivePopupGuidance({ isConversationPage: false }).action, "open-chatgpt");
  assert.equal(derivePopupGuidance({ isConversationPage: true, historyJob: { status: "paused", stats: { completed: 42 } } }).action, "open-backup");
  assert.equal(derivePopupGuidance({ isConversationPage: true, libraryStats: { conversations: 9 } }).action, "open-library");
});

test("backup health distinguishes browser cache from computer backup", () => {
  const health = deriveBackupHealth({ status: "completed", stats: { completed: 120 }, archiveExport: { status: "idle", completedVolumes: [], totalVolumes: 0 } }, { usage: 10, quota: 100, persisted: false });
  assert.match(health.title, /电脑备份尚未完成/);
  assert.equal(health.browserState, "已保存 120 条");
  assert.equal(health.computerState, "尚未生成");
});

test("backup preflight stays useful even when list totals are unavailable", () => {
  const preflight = buildBackupPreflight({ workspaceLabel: "个人空间", existingJob: { stats: { completed: 8 } }, storage: { usage: 1024, quota: 4096 }, assetPolicy: "references-only" });
  assert.equal(preflight.estimatedConversations, 8);
  assert.match(preflight.storageLabel, /剩余/);
  assert.match(preflight.assetLabel, /附件引用/);
});

test("recovery actions map common failures to direct user actions", () => {
  assert.equal(classifyRecoveryAction("未找到 ChatGPT 标签页").kind, "open-chatgpt");
  assert.equal(classifyRecoveryAction("分卷下载被浏览器中断").kind, "show-downloads");
  assert.equal(classifyRecoveryAction("unknown").kind, "retry");
});

test("knowledge quality gives a plain-language gate before technical metrics", () => {
  const safe = summarizeKnowledgeQuality({ volumeCount: 2, graphValidation: { metrics: {} }, vault: { report: { brokenLinks: [], invalidCanvasReferences: [] } }, assetStats: {} });
  assert.equal(safe.title, "可以安全导出");
  const blocked = summarizeKnowledgeQuality({ graphValidation: { metrics: { danglingEdges: 1 } }, vault: { report: { brokenLinks: [], invalidCanvasReferences: [] } }, assetStats: {} });
  assert.equal(blocked.tone, "danger");
});
