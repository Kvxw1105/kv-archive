import assert from "node:assert/strict";
import test from "node:test";
import {
  scheduleConfigurationSummary,
  scheduleStatusPresentation,
} from "../apps/extension/src/schedule-presentation.js";

test("scheduler states map to explicit text and semantic tones", () => {
  assert.deepEqual(scheduleStatusPresentation("disabled"), { label: "未开启", tone: "neutral" });
  assert.deepEqual(scheduleStatusPresentation("idle"), { label: "已开启", tone: "good" });
  assert.deepEqual(scheduleStatusPresentation("running"), { label: "正在备份", tone: "active" });
  assert.deepEqual(scheduleStatusPresentation("waiting_for_idle"), { label: "等待浏览器空闲", tone: "warning" });
  assert.deepEqual(scheduleStatusPresentation("waiting_for_other_backup"), { label: "等待其他任务", tone: "warning" });
  assert.deepEqual(scheduleStatusPresentation("continuation_pending"), { label: "后台继续中", tone: "active" });
  assert.deepEqual(scheduleStatusPresentation("success"), { label: "运行正常", tone: "good" });
  assert.deepEqual(scheduleStatusPresentation("success_with_warnings"), { label: "有待处理项", tone: "warning" });
  assert.deepEqual(scheduleStatusPresentation("failed"), { label: "需要处理", tone: "danger" });
  assert.deepEqual(scheduleStatusPresentation("unexpected"), { label: "状态未知", tone: "neutral" });
});

test("configuration summary stays compact and truthful", () => {
  assert.equal(scheduleConfigurationSummary({ intervalDays: 1, localTime: "08:15", idleOnly: false }), "每天 · 08:15");
  assert.equal(scheduleConfigurationSummary({ intervalDays: 3, localTime: "03:30", idleOnly: true }), "每 3 天 · 03:30 · 仅空闲时");
  assert.equal(scheduleConfigurationSummary({ intervalDays: 14, localTime: "21:00", idleOnly: true }), "每 14 天 · 21:00 · 仅空闲时");
});
