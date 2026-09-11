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
  assert.match(backupSource, /scheduleStatusPresentation\(runtime\.status\)/);
  assert.match(backupSource, /scheduleConfigurationSummary\(settings\)/);
  assert.match(backupSource, /elements\["schedule-status-badge"\]\.dataset\.tone/);
  assert.match(backupSource, /elements\["schedule-enable-action"\]\.hidden = Boolean\(settings\.enabled\)/);
  assert.match(backupSource, /elements\["schedule-settings"\]\.open = true/);
  assert.match(backupSource, /if \(!countdown \|\| !progress \|\| !bar \|\| !label\) return;/);
});

test("scheduled backup is a first-class card while settings and acceptance stay progressive", async () => {
  const html = await readFile("apps/extension/src/backup.html", "utf8");
  const start = html.indexOf('<section id="automatic-backup"');
  const end = html.indexOf('<section class="card workspace-card"', start);
  assert.ok(start >= 0, "automatic backup needs an always-visible landmark");
  assert.ok(end > start, "automatic backup must appear directly before workspace selection");

  const card = html.slice(start, end);
  assert.match(card, /class="card schedule-card schedule-primary"/);
  assert.match(card, /id="schedule-status-badge"/);
  assert.match(card, /id="schedule-state"/);
  assert.match(card, /id="schedule-next"/);
  assert.match(card, /id="schedule-last"/);
  assert.match(card, /id="schedule-run"[^>]*>立即增量备份</);
  assert.match(card, /id="schedule-refresh"/);
  assert.match(card, /id="schedule-enable-action"/);
  assert.match(card, /<details id="schedule-settings"/);
  assert.match(card, /id="schedule-settings-summary"/);
  assert.match(card, /<details class="schedule-tools"/);
  assert.ok(card.indexOf('id="schedule-run"') < card.indexOf('id="schedule-settings"'));
  assert.doesNotMatch(card, /<details class="card schedule-card advanced-surface"/);
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
