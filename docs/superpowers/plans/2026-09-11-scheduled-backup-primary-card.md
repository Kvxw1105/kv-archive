# Scheduled Backup Primary Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not spawn subagents; this plan is intentionally detailed enough for one executor.

**Goal:** Promote scheduled incremental backup from a hidden outer disclosure to an always-visible Backup Center primary card with truthful status, decisive actions, compact advanced settings, and a de-emphasized acceptance tool.

**Architecture:** Preserve every scheduler message, alarm, IndexedDB, and backup-engine contract. Add one pure presentation module for status/configuration labels, restructure only the Backup Center markup, and keep `backup.js` as the adapter from authoritative runtime payloads to DOM state. Use targeted contract/unit tests first, then one full regression and one extension build; do not add redundant compatibility layers or defensive state machines.

**Tech Stack:** Vanilla HTML/CSS/ES modules, Chrome MV3, Node.js `node:test`, npm, Git/GitHub PR #3.

---

## Scope and protected work

- Preserve the existing uncommitted CRLF compatibility change in `tests/pwa.test.mjs`; do not stage, revert, or rewrite it.
- Preserve all current control IDs and runtime messages so scheduler behavior remains unchanged.
- Do not change IndexedDB version 13, alarm names, archive formats, Raw Evidence, Evidence URI, Portable Capture, snapshots, or Agent Bundle contracts.
- Do not bump extension version; this remains an unreleased `0.16.11` branch change.
- Do not create additional Agents or subagents. Execute this plan in one task.
- Do not auto-merge PR #3 or create a release.

## File map

- Create `apps/extension/src/schedule-presentation.js`: pure status/configuration view models.
- Create `tests/schedule-presentation.test.mjs`: direct unit coverage for that module.
- Modify `apps/extension/src/backup.html`: promote the scheduler and nest only settings/acceptance tools.
- Modify `apps/extension/src/backup.css`: visual hierarchy, status beacon, disclosures, responsive layout.
- Modify `apps/extension/src/backup.js`: bind view models and the explicit setup action to existing controls.
- Modify `tests/scheduled-integration.test.mjs`: scheduler DOM/wiring contract.
- Modify `tests/ui-shell.test.mjs`: progressive-disclosure contract reflects the new hierarchy.
- Update `.agent-harness/CURRENT_STATE.md` and `.agent-harness/HANDOFF.md` after verified implementation.

### Task 1: Lock the new UI contract with failing tests

**Files:**
- Modify: `tests/scheduled-integration.test.mjs`
- Modify: `tests/ui-shell.test.mjs`

- [ ] **Step 1: Add the primary-card contract test**

Append this test to `tests/scheduled-integration.test.mjs`:

```js
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
```

- [ ] **Step 2: Update the shell hierarchy assertion**

In `tests/ui-shell.test.mjs`, replace:

```js
assert.match(backup, /class="[^"]*\badvanced-surface\b[^"]*"/);
```

with:

```js
assert.match(backup, /id="automatic-backup" class="card schedule-card schedule-primary"/);
assert.match(backup, /<details id="schedule-settings"/);
assert.match(backup, /<details class="schedule-tools"/);
```

- [ ] **Step 3: Run the tests and verify RED**

Run:

```powershell
node --test tests/scheduled-integration.test.mjs tests/ui-shell.test.mjs
```

Expected: the new primary-card test fails because `automatic-backup` and its visible controls do not exist; unrelated existing assertions remain green.

### Task 2: Add the pure scheduler presentation model

**Files:**
- Create: `apps/extension/src/schedule-presentation.js`
- Create: `tests/schedule-presentation.test.mjs`

- [ ] **Step 1: Write the presentation tests**

Create `tests/schedule-presentation.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
node --test tests/schedule-presentation.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `schedule-presentation.js`.

- [ ] **Step 3: Implement the presentation module**

Create `apps/extension/src/schedule-presentation.js`:

```js
const STATUS_PRESENTATION = Object.freeze({
  disabled: { label: "未开启", tone: "neutral" },
  idle: { label: "已开启", tone: "good" },
  running: { label: "正在备份", tone: "active" },
  waiting_for_idle: { label: "等待浏览器空闲", tone: "warning" },
  waiting_for_other_backup: { label: "等待其他任务", tone: "warning" },
  continuation_pending: { label: "后台继续中", tone: "active" },
  success: { label: "运行正常", tone: "good" },
  success_with_warnings: { label: "有待处理项", tone: "warning" },
  failed: { label: "需要处理", tone: "danger" },
});

export function scheduleStatusPresentation(status) {
  return STATUS_PRESENTATION[status] ?? { label: "状态未知", tone: "neutral" };
}

export function scheduleConfigurationSummary(settings = {}) {
  const days = Math.max(1, Math.floor(Number(settings.intervalDays) || 3));
  const interval = ({ 1: "每天", 3: "每 3 天", 7: "每周", 30: "每 30 天" })[days] ?? `每 ${days} 天`;
  const time = /^\d{2}:\d{2}$/.test(String(settings.localTime || "")) ? settings.localTime : "03:30";
  return `${interval} · ${time}${settings.idleOnly === false ? "" : " · 仅空闲时"}`;
}
```

- [ ] **Step 4: Run the presentation tests and verify GREEN**

Run:

```powershell
node --test tests/schedule-presentation.test.mjs
```

Expected: 2/2 PASS.

### Task 3: Promote and restructure the scheduler markup

**Files:**
- Modify: `apps/extension/src/backup.html:66-115`

- [ ] **Step 1: Replace the outer scheduler disclosure**

Remove the complete existing outer scheduler `<details>` block. Insert this markup immediately after `</section>` for `id="backup-health"` and before `<section class="card workspace-card">`:

```html
<section id="automatic-backup" class="card schedule-card schedule-primary" data-state="unknown">
  <div class="schedule-primary-head">
    <div class="section-index">
      <span>01A</span>
      <div>
        <span class="phase">AUTOMATIC BACKUP</span>
        <h2>定时增量备份</h2>
        <p>自动扫描新增与变更内容，建立可恢复的逻辑快照；Chrome 错过计划时间后会在下次启动补跑。</p>
      </div>
    </div>
    <div class="schedule-primary-controls">
      <span id="schedule-status-badge" class="schedule-status-badge" data-tone="neutral">状态未知</span>
      <label class="switch-row"><input id="schedule-enabled" type="checkbox"><span>自动备份</span></label>
    </div>
  </div>

  <div class="schedule-summary schedule-summary-primary">
    <div><span>当前状态</span><strong id="schedule-state">未启用</strong></div>
    <div><span>下次运行</span><strong id="schedule-next">未启用</strong></div>
    <div><span>上次成功</span><strong id="schedule-last">尚无</strong></div>
  </div>
  <div class="schedule-summary schedule-summary-evidence">
    <div><span>逻辑快照</span><strong id="schedule-snapshots">0</strong></div>
    <div><span>最近变化</span><strong id="schedule-delta">+0 · ~0 · −0</strong></div>
    <div><span>本轮复用节省</span><strong id="schedule-dedup">0 B</strong></div>
  </div>

  <p id="schedule-message" class="status inline-note">正在读取自动备份状态…</p>
  <div class="actions schedule-primary-actions">
    <button id="schedule-run" class="primary">立即增量备份</button>
    <button id="schedule-enable-action" class="primary" hidden>设置并开启自动备份</button>
    <button id="schedule-refresh" class="secondary">刷新状态</button>
  </div>

  <details id="schedule-settings" class="schedule-disclosure">
    <summary><span><strong>调整自动备份设置</strong><small id="schedule-settings-summary">每 3 天 · 03:30 · 仅空闲时</small></span><span>展开设置</span></summary>
    <div class="schedule-settings-body">
      <div class="schedule-grid">
        <label><span>执行频率</span><select id="schedule-frequency"><option value="1">每天</option><option value="3">每 3 天</option><option value="7">每周</option><option value="30">每 30 天</option></select></label>
        <label><span>本地时间</span><input id="schedule-time" type="time" value="03:30"></label>
        <label><span>附件策略</span><select id="schedule-assets"><option value="references-only">仅保存附件引用（推荐）</option><option value="download">同时下载新增附件</option></select></label>
        <label><span>最多保留快照</span><input id="schedule-retention-count" type="number" min="1" max="365" value="30"></label>
        <label><span>最长保留天数</span><input id="schedule-retention-days" type="number" min="1" max="3650" value="180"></label>
        <label class="check-row"><input id="schedule-idle" type="checkbox" checked><span>仅在浏览器空闲时启动</span></label>
      </div>
      <div class="actions"><button id="schedule-save" class="primary">保存定时设置</button></div>
    </div>
  </details>

  <details class="schedule-tools">
    <summary><span><strong>验收工具</strong><small>验证 Chrome Alarm 与自动增量链路</small></span><span>按需展开</span></summary>
    <div class="schedule-tools-body">
      <section class="schedule-test-panel" aria-labelledby="schedule-test-title">
        <div class="schedule-test-copy">
          <span class="phase">TEN-MINUTE ACCEPTANCE</span>
          <h3 id="schedule-test-title">10 分钟自动增量验收</h3>
          <p>先保留一份基线快照，然后在 10 分钟内新建或编辑一条 ChatGPT 会话。到时扩展会由 Chrome Alarm 自动唤醒并运行增量检查。</p>
        </div>
        <div class="schedule-summary schedule-test-summary">
          <div><span>验收状态</span><strong id="schedule-test-state">未启动</strong></div>
          <div><span>自动触发时间</span><strong id="schedule-test-due">尚无</strong></div>
          <div><span>剩余时间</span><strong id="schedule-test-countdown">尚无</strong></div>
          <div><span>检测结果</span><strong id="schedule-test-result">尚无</strong></div>
        </div>
        <div id="schedule-test-progress" class="schedule-test-progress" hidden><div class="schedule-test-progress__track"><span id="schedule-test-progress-bar"></span></div><small id="schedule-test-progress-label">等待开始</small></div>
        <p id="schedule-test-message" class="status inline-note">需要至少一份逻辑快照作为比较基线。测试期间可以关闭 KV Archive 页面，但应保持 Chrome 运行并保留一个已登录 ChatGPT 标签页。</p>
        <div class="actions">
          <button id="schedule-test-start" class="secondary">开始 10 分钟验收</button>
          <button id="schedule-test-cancel" class="ghost" disabled>取消待运行验收</button>
        </div>
      </section>
    </div>
  </details>
</section>
```

Use the literal existing `schedule-grid` block in place of its comment and the literal existing `schedule-test-panel` block in place of its comment. Do not duplicate an ID. Renumber the workspace heading from `01A` to `01B` so page order remains intelligible.

- [ ] **Step 2: Run the DOM contract tests**

Run:

```powershell
node --test tests/scheduled-integration.test.mjs tests/ui-shell.test.mjs
```

Expected: primary-card hierarchy assertions pass; JS presentation wiring assertions may remain pending until Task 4.

### Task 4: Bind authoritative runtime state to the new card

**Files:**
- Modify: `apps/extension/src/backup.js:1-63,150-166,262-310,1103-1108`
- Modify: `tests/scheduled-integration.test.mjs`

- [ ] **Step 1: Add failing source-wiring assertions**

Inside the first test in `tests/scheduled-integration.test.mjs`, after reading `backupSource`, add:

```js
assert.match(backupSource, /scheduleStatusPresentation\(runtime\.status\)/);
assert.match(backupSource, /scheduleConfigurationSummary\(settings\)/);
assert.match(backupSource, /elements\["schedule-status-badge"\]\.dataset\.tone/);
assert.match(backupSource, /elements\["schedule-enable-action"\]\.hidden = Boolean\(settings\.enabled\)/);
assert.match(backupSource, /elements\["schedule-settings"\]\.open = true/);
```

Run:

```powershell
node --test tests/scheduled-integration.test.mjs
```

Expected: FAIL because the new presentation functions are not wired.

- [ ] **Step 2: Import and register new elements**

Add after existing imports in `apps/extension/src/backup.js`:

```js
import { scheduleConfigurationSummary, scheduleStatusPresentation } from "./schedule-presentation.js";
```

Add these IDs to the `ids` array:

```js
"automatic-backup", "schedule-status-badge", "schedule-enable-action", "schedule-settings", "schedule-settings-summary",
```

- [ ] **Step 3: Render card state from the existing payload**

At the beginning of `renderScheduleStatus(payload)`, after `settings` and `runtime` are defined, add:

```js
const presentation = scheduleStatusPresentation(runtime.status);
elements["automatic-backup"].dataset.state = runtime.status || "unknown";
elements["schedule-status-badge"].textContent = presentation.label;
elements["schedule-status-badge"].dataset.tone = presentation.tone;
elements["schedule-settings-summary"].textContent = scheduleConfigurationSummary(settings);
elements["schedule-enable-action"].hidden = Boolean(settings.enabled);
```

In `loadScheduleStatus()` catch, before returning `null`, add:

```js
const presentation = scheduleStatusPresentation("unknown");
elements["automatic-backup"].dataset.state = "unknown";
elements["schedule-status-badge"].textContent = presentation.label;
elements["schedule-status-badge"].dataset.tone = presentation.tone;
```

Do not alter `scheduleStateLabel`, scheduler runtime values, polling, or message payloads.

- [ ] **Step 4: Add the explicit setup interaction**

Add next to the existing scheduler listeners:

```js
elements["schedule-enable-action"].addEventListener("click", () => {
  elements["schedule-enabled"].checked = true;
  elements["schedule-settings"].open = true;
  elements["schedule-message"].textContent = "已选择开启自动备份。确认执行频率和时间后，点击“保存定时设置”生效。";
  elements["schedule-message"].dataset.tone = "warning";
  elements["schedule-time"].focus();
});
```

This interaction exposes the choice but does not save silently.

- [ ] **Step 5: Run presentation and integration tests**

Run:

```powershell
node --test tests/schedule-presentation.test.mjs tests/scheduled-integration.test.mjs tests/ui-shell.test.mjs tests/scheduled-test-mode.test.mjs tests/task-feedback.test.mjs
```

Expected: all tests PASS. Existing ten-minute acceptance IDs and countdown guards remain present.

### Task 5: Implement the visual hierarchy and responsive behavior

**Files:**
- Modify: `apps/extension/src/backup.css`
- Modify: `tests/ui-visibility.test.mjs`

- [ ] **Step 1: Add failing CSS contract assertions**

Append to `tests/ui-visibility.test.mjs`:

```js
test("scheduled backup primary card exposes semantic state and responsive hierarchy", async () => {
  const css = await readFile("apps/extension/src/backup.css", "utf8");
  assert.match(css, /\.schedule-primary-head/);
  assert.match(css, /\.schedule-status-badge\[data-tone="good"\]/);
  assert.match(css, /\.schedule-status-badge\[data-tone="warning"\]/);
  assert.match(css, /\.schedule-status-badge\[data-tone="danger"\]/);
  assert.match(css, /\.schedule-summary-primary/);
  assert.match(css, /\.schedule-disclosure/);
  assert.match(css, /@media \(max-width: 620px\)/);
});
```

The test file already imports `readFile`; reuse that import.

Run:

```powershell
node --test tests/ui-visibility.test.mjs
```

Expected: FAIL because the primary-card selectors do not exist.

- [ ] **Step 2: Replace obsolete outer-disclosure styles and add card styles**

Keep shared `.schedule-grid`, `.schedule-summary`, `.inline-note`, and test-progress styles. Remove scheduler-only dependence on `.advanced-surface`, `.advanced-summary`, and `.schedule-body`, then add:

```css
.schedule-primary {
  display: grid;
  gap: 16px;
  margin-top: 14px;
  border-color: color-mix(in srgb, var(--kv-accent) 28%, var(--kv-line));
  background: linear-gradient(135deg, rgba(143,197,173,.06), rgba(255,255,255,.012) 48%, transparent);
}
.schedule-primary-head { display:flex; justify-content:space-between; align-items:flex-start; gap:28px; }
.schedule-primary-head .section-index { max-width:820px; }
.schedule-primary-head p { max-width:700px; margin:8px 0 0; color:var(--kv-muted); }
.schedule-primary-controls { display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
.schedule-status-badge { display:inline-flex; align-items:center; min-height:32px; padding:6px 11px; border:1px solid var(--kv-line); border-radius:999px; font:700 11px/1 var(--kv-body); }
.schedule-status-badge::before { content:""; width:7px; height:7px; margin-right:7px; border-radius:50%; background:currentColor; box-shadow:0 0 12px currentColor; }
.schedule-status-badge[data-tone="neutral"] { color:var(--kv-muted); }
.schedule-status-badge[data-tone="good"] { color:var(--kv-good); border-color:rgba(143,197,173,.32); }
.schedule-status-badge[data-tone="active"] { color:var(--kv-accent); border-color:rgba(143,197,173,.38); }
.schedule-status-badge[data-tone="warning"] { color:var(--kv-warn); border-color:rgba(199,165,104,.34); }
.schedule-status-badge[data-tone="danger"] { color:var(--kv-danger); border-color:rgba(223,145,135,.36); }
.schedule-summary-primary, .schedule-summary-evidence { grid-template-columns:repeat(3,minmax(0,1fr)); }
.schedule-summary-primary strong { font-size:16px; }
.schedule-summary-evidence { background:transparent; }
.schedule-summary-evidence strong { color:var(--kv-muted); }
.schedule-primary-actions { align-items:center; }
.schedule-disclosure, .schedule-tools { border:1px solid var(--kv-line); border-radius:14px; overflow:hidden; background:rgba(255,255,255,.01); }
.schedule-disclosure > summary, .schedule-tools > summary { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:14px 16px; cursor:pointer; list-style:none; }
.schedule-disclosure > summary::-webkit-details-marker, .schedule-tools > summary::-webkit-details-marker { display:none; }
.schedule-disclosure summary > span:first-child, .schedule-tools summary > span:first-child { display:grid; gap:4px; }
.schedule-disclosure summary small, .schedule-tools summary small { color:var(--kv-faint); font-size:11px; }
.schedule-disclosure summary > span:last-child, .schedule-tools summary > span:last-child { color:var(--kv-faint); font-size:11px; }
.schedule-settings-body, .schedule-tools-body { display:grid; gap:14px; padding:16px; border-top:1px solid var(--kv-line); }
```

Extend the existing `@media (max-width: 620px)` block with:

```css
.schedule-primary-head { display:grid; }
.schedule-primary-controls { justify-content:flex-start; }
.schedule-summary-primary, .schedule-summary-evidence { grid-template-columns:1fr 1fr; }
.schedule-primary-actions > button { flex:1 1 100%; }
```

Extend the existing `@media (max-width: 420px)` block with:

```css
.schedule-summary-primary, .schedule-summary-evidence { grid-template-columns:1fr; }
```

- [ ] **Step 3: Run UI tests and typecheck**

Run:

```powershell
node --test tests/ui-visibility.test.mjs tests/ui-shell.test.mjs tests/scheduled-integration.test.mjs tests/theme-system.test.mjs
npm run typecheck
```

Expected: all tests and typecheck PASS with no missing CSS token or hidden-state regression.

### Task 6: Verify, document, commit, and update PR #3

**Files:**
- Modify: `.agent-harness/CURRENT_STATE.md`
- Modify: `.agent-harness/HANDOFF.md`
- Preserve unstaged: `tests/pwa.test.mjs`

- [ ] **Step 1: Build and run the complete deterministic suite once**

Run:

```powershell
npm run build:extension
npm test
```

Expected: extension build PASS and 297 existing tests plus the newly added tests all PASS. Do not repeat the seven performance gates because this change does not touch performance/data paths and they already passed at commit `85f0a5a`.

- [ ] **Step 2: Inspect the generated extension and diff**

Run:

```powershell
(Get-Content apps/extension/dist/manifest.json -Raw | ConvertFrom-Json).version
git status --short
git diff --check
git diff --stat
git diff -- apps/extension/src tests/schedule-presentation.test.mjs tests/scheduled-integration.test.mjs tests/ui-shell.test.mjs tests/ui-visibility.test.mjs .agent-harness
```

Expected: manifest remains `0.16.11`; tracked source changes are scoped to this feature and state docs; `tests/pwa.test.mjs` remains unstaged and unchanged from its pre-task user modification; generated build files are not committed.

- [ ] **Step 3: Update project state truthfully**

Add one concise milestone to `.agent-harness/CURRENT_STATE.md` and `.agent-harness/HANDOFF.md` stating:

```text
Scheduled incremental backup is now an always-visible Backup Center primary card; status, next/last run, reuse evidence, and immediate action no longer require expanding an advanced drawer. Settings and the 10-minute acceptance tool remain progressively disclosed. Scheduler storage/alarm contracts and DB v13 are unchanged.
```

Record exact test counts and note that real owner-profile visual/reload acceptance remains pending until actually observed.

- [ ] **Step 4: Commit only scoped implementation files**

Run:

```powershell
git add apps/extension/src/backup.html apps/extension/src/backup.css apps/extension/src/backup.js apps/extension/src/schedule-presentation.js tests/schedule-presentation.test.mjs tests/scheduled-integration.test.mjs tests/ui-shell.test.mjs tests/ui-visibility.test.mjs .agent-harness/CURRENT_STATE.md .agent-harness/HANDOFF.md docs/superpowers/plans/2026-09-11-scheduled-backup-primary-card.md
git diff --cached --check
git diff --cached --name-status
git commit -m "feat: make scheduled backup a primary workflow"
```

Expected: the commit excludes `tests/pwa.test.mjs` and any private/generated files.

- [ ] **Step 5: Push and verify PR CI**

Run:

```powershell
git push origin fix/stuck-project-conversation-indexing
gh pr view 3 --repo Kvxw1105/kv-archive --json headRefOid,statusCheckRollup,url
gh pr checks 3 --repo Kvxw1105/kv-archive --watch
```

Expected: PR #3 head matches local HEAD and required `verify` succeeds for that SHA. Do not merge.

- [ ] **Step 6: Request only the final owner visual check**

Ask the owner to Reload KV Archive once, refresh Backup Center, and confirm the automatic-backup card is visible without expansion in desktop width and narrow width. Request one screenshot only if a visual defect is reported. Do not rerun unrelated real-data acceptance steps solely for this presentation change.

## Completion levels

Report separately:

- `EDITED`: source/UI/tests/state updated.
- `LOCALLY_VERIFIED`: targeted tests, typecheck, extension build, and full deterministic suite pass.
- `COMMITTED`: scoped feature commit exists.
- `PUSHED`: branch contains the commit remotely.
- `PR_UPDATED`: PR #3 head matches the commit.
- `CI_PASSED`: required check succeeds for that exact SHA.
- `RELEASED`: remains false unless the owner separately authorizes merge/release.
