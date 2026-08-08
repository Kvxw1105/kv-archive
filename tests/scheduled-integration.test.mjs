import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("extension declares scheduler permissions, background hooks and backup controls", async () => {
  const manifest = JSON.parse(await readFile("apps/extension/src/manifest.json", "utf8"));
  assert.equal(manifest.version, "0.16.11");
  assert.ok(Number(manifest.minimum_chrome_version) >= 116);
  for (const permission of ["alarms", "idle", "notifications"]) assert.ok(manifest.permissions.includes(permission));

  const background = await readFile("apps/extension/src/background.js", "utf8");
  assert.match(background, /chrome\.alarms\.onAlarm/);
  assert.match(background, /chrome\.runtime\.onStartup/);
  assert.match(background, /context-vault-schedule-run-now/);
  assert.match(background, /context-vault-schedule-test-start/);
  assert.match(background, /context-vault-schedule-test-cancel/);

  const html = await readFile("apps/extension/src/backup.html", "utf8");
  const scheduleIds = [
    "schedule-enabled", "schedule-frequency", "schedule-time", "schedule-save", "schedule-run", "schedule-delta", "schedule-dedup",
    "schedule-test-start", "schedule-test-cancel", "schedule-test-state", "schedule-test-result",
    "schedule-test-countdown", "schedule-test-progress", "schedule-test-progress-bar", "schedule-test-progress-label",
  ];
  for (const id of scheduleIds) assert.match(html, new RegExp(`id=["']${id}["']`));

  const backupSource = await readFile("apps/extension/src/backup.js", "utf8");
  const idsStart = backupSource.indexOf("const ids = [");
  const idsEnd = backupSource.indexOf("];", idsStart);
  const idsBlock = backupSource.slice(idsStart, idsEnd);
  for (const id of ["schedule-test-countdown", "schedule-test-progress", "schedule-test-progress-bar", "schedule-test-progress-label"]) {
    assert.match(idsBlock, new RegExp(`["']${id}["']`), `${id} must be registered before countdown rendering`);
  }
  assert.match(backupSource, /if \(!countdown \|\| !progress \|\| !bar \|\| !label\) return;/);
});

test("manual backup releases its lease even when no ChatGPT tab is available", async () => {
  const source = await readFile("apps/extension/src/backup.js", "utf8");
  const start = source.indexOf("async function runBackup");
  const end = source.indexOf("elements.start.addEventListener", start);
  const body = source.slice(start, end);
  assert.match(body, /let leaseAcquired = false/);
  assert.match(body, /finally\s*\{/);
  assert.match(body, /if \(leaseAcquired\) await releaseManualLease\(\)/);
  assert.ok(body.indexOf("if (!tab?.id)") < body.indexOf("finally"));
});

test("content object garbage collection uses a cursor instead of loading every payload", async () => {
  const source = await readFile("apps/extension/src/snapshot-store.js", "utf8");
  const start = source.indexOf("async listContentObjectMetadata");
  const end = source.indexOf("async deleteContentObject", start);
  const body = source.slice(start, end);
  assert.match(body, /openCursor/);
  assert.doesNotMatch(body, /getAll\(/);
});
