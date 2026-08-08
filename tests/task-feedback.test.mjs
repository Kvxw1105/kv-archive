import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  clampTaskProgress,
  estimateTaskRemaining,
  formatTaskDuration,
  progressFromCounts,
} from "../apps/extension/src/task-feedback.js";

test("task progress helpers clamp and reject unknown values", () => {
  assert.equal(clampTaskProgress(-12), 0);
  assert.equal(clampTaskProgress(49.6), 50);
  assert.equal(clampTaskProgress(155), 100);
  assert.equal(clampTaskProgress("not-a-number"), null);
  assert.equal(progressFromCounts(25, 100), 25);
  assert.equal(progressFromCounts(1, 0), null);
});

test("task duration and ETA use real elapsed throughput", () => {
  assert.equal(formatTaskDuration(12_000), "12 秒");
  assert.equal(formatTaskDuration(75_000), "1 分 15 秒");
  assert.equal(formatTaskDuration(3_600_000), "1 小时");
  assert.equal(estimateTaskRemaining({ startedAt: 1_000, now: 11_000, current: 5, total: 10 }), 10_000);
  assert.equal(estimateTaskRemaining({ startedAt: 1_000, now: 11_000, current: 0, total: 10 }), null);
});

test("all long-running workspace surfaces load the shared task feedback system", async () => {
  const pages = ["backup", "basket", "capture", "knowledge", "library", "memory", "state", "popup"];
  for (const page of pages) {
    const html = await readFile(new URL(`../apps/extension/src/${page}.html`, import.meta.url), "utf8");
    assert.match(html, /task-feedback\.css/, `${page}.html should load task-feedback.css`);
    const script = await readFile(new URL(`../apps/extension/src/${page}.js`, import.meta.url), "utf8");
    assert.match(script, /createTaskFeedback/, `${page}.js should create task feedback`);
  }
});

test("task feedback respects reduced motion and mobile safe-area layout", async () => {
  const css = await readFile(new URL("../apps/extension/src/task-feedback.css", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /html\.has-task-feedback body/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test("remaining long-running surfaces expose truthful feedback coverage", async () => {
  const backup = await readFile(new URL("../apps/extension/src/backup.js", import.meta.url), "utf8");
  const backupHtml = await readFile(new URL("../apps/extension/src/backup.html", import.meta.url), "utf8");
  const library = await readFile(new URL("../apps/extension/src/library.js", import.meta.url), "utf8");
  const popup = await readFile(new URL("../apps/extension/src/popup.js", import.meta.url), "utf8");
  assert.match(backupHtml, /schedule-test-countdown/);
  assert.match(backup, /updateScheduleTestCountdown/);
  assert.match(backup, /backup-preflight/);
  assert.match(backup, /acceptance-diagnostic/);
  assert.match(backup, /backup-reset/);
  assert.match(library, /library-search/);
  assert.match(library, /library-detail/);
  assert.doesNotMatch(popup, /progress:\s*(32|67|86)/);
});
