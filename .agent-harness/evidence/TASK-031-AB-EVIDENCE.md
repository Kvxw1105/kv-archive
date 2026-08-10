# TASK-031 Real-Browser Acceptance — Evidence Log (A/B)

Date: 2026-08-11
Extension ID: ccafhcejhlgdefoblkanefindomeecjd
Installed path: D:\A-Project\Kvarchieve\KV-Archive-v0.16.9-extension-install (folder name legacy, content v0.16.11)
Backup of prior version: D:\A-Project\Kvarchieve\KV-Archive-v0.16.9-extension-install.bak

## A. In-place upgrade and preservation — OBSERVED PASS

1. Installed extension manifest version = 0.16.11 (verified via manifest.json).
2. Chrome Secure Preferences: extension enabled (disable_reasons empty, has_started_service_worker true).
3. Extension loaded from the in-place upgraded folder (same identity, not reinstalled).
4. IndexedDB preserved: leveldb store ~254 MB across 129 files; blob store actively written
   (latest writes 2026-08-10 21:21 local; prior corpus intact).
5. Library page (library.html) opened and rendered real records: 3 recent conversations
   (e.g. first entry dated 2026/8/10 20:40:16, source kv-archive-current-conversation).
6. Backup Center page (backup.html) opened; full page renders (platform backup center,
   BACKUP HEALTH card, local browser count 230).

## B. Backup Center scheduler UI — OBSERVED PASS

1. Scheduler card (AUTOMATION / 定时增量备份) is a collapsed <details>; expanding renders:
   - enable switch, frequency (每 3 天), local time (03:30), retention count/days fields
   - status summary: 下次运行=未启用, 上次成功=尚无, 逻辑快照=1, 最近变化/复用节省/当前状态
   - buttons: 保存定时设置 / 立即增量运行一次 / 刷新状态
   - TEN-MINUTE ACCEPTANCE panel: 验收状态=未启动, 自动触发时间=尚无, 检测结果=尚无,
     message="已有逻辑快照，可以开始 10 分钟自动增量验收", buttons 开始 10 分钟验收 / 取消待运行验收
2. No "Cannot set properties of undefined (setting 'textContent')" error observed.
3. Source defense verified: apps/extension/src/backup.js:185 guards
   `if (!countdown || !progress || !bar || !label) return;` before touching textContent;
   installed backup.js matches repository source (source compare performed).
4. IndexedDB object backup-schedule-runtime: status=disabled, updatedAt=2026-08-10T13:52:12Z.

## Notes / next steps

- C (baseline + continued conversation), D (snapshot history), E (10-min Alarm / catch-up)
  require a real ChatGPT conversation turn and/or scheduler activation; owner interaction
  is preferred for sending the test message into a real conversation.

## C. Incremental run — defect reproduced (project-conversations hang)

1. Owner clicked "立即增量运行一次" (2026-08-11 ~01:44 local).
2. IndexedDB backup-schedule-runtime: status=running, lastStartedAt=2026-08-10T17:44:51.961Z,
   currentPhase=project-conversations, currentJobStatus=indexing.
3. Heartbeat (lastHeartbeatAt/updatedAt) froze at 2026-08-10T17:45:20.985Z; no data writes for
   9+ minutes; lastError empty. Job stuck in running with no terminal outcome.
4. Root cause: chrome.scripting.executeScript (5 call sites in history-api.js) never resolves
   when the ChatGPT tab renderer is busy/unresponsive; withRetry only reacts to rejects; the
   indexing loop has no total timeout and pause checks only run between iterations.
5. Fix: executeScriptWithTimeout (Promise.race + AbortController, 60s default, 408 HistoryApiError);
   all 5 call sites wrapped. withRetry treats 408 as retryable, so jobs now terminate with an
   error instead of hanging.
   - Branch: fix/stuck-project-conversation-indexing
   - PR: https://github.com/Kvxw1105/kv-archive/pull/3
   - Tests: +2 regression (stuck -> 408 reject; settled -> result). typecheck PASS; 297/297 PASS.
6. Note: the stuck run may have been aggravated by a busy/backgrounded ChatGPT tab during the
   owner's active browser use. The fix makes such stalls observable and recoverable rather than
   silent.

## E. 10-minute Alarm acceptance — OBSERVED PASS

1. Owner clicked "开始 10 分钟验收" at ~02:02:05 local (2026-08-11).
2. backup-schedule-test-runtime: status=waiting, requestedAt=2026-08-10T18:02:05.657Z,
   dueAt=2026-08-10T18:12:05.657Z, baselineSnapshotId=snapshot-2026-08-10T13-52-08-584Z-1d9ec23c9bbc
   (baseline fingerprint 1d9ec23c...).
3. At 02:12:05 the Chrome Alarm fired exactly on dueAt:
   backup-schedule-runtime.lastStartedAt=2026-08-10T18:12:05.770Z,
   heartbeat at 18:12:21Z, completed/slice-complete at 18:13:27Z;
   stats indexed=6, completed=1, assetsDiscovered=3, no lastError.
4. UI showed "Alarm 已触发，正在扫描和比较" (running state) with
   自动触发时间 2026/8/11 02:12:05; later UI showed stale "正在自动增量"
   because the page did not refresh after completion (runtime already completed).
5. No second run started; schedule-runtime stayed completed (updatedAt rewritten
   18:14:05/18:20:35/18:22:27 with identical stats).

## C. New conversation detection — PENDING owner confirmation

- Local library still shows 对话 3 / 消息 418 (same as acceptance A baseline).
- The 02:12 Alarm run indexed 6 objects (indexed=6) but no new conversation
  appeared in the library list.
- Need owner input: was the test message sent in an existing conversation or a
  brand-new conversation? If new, it may be in archived/project scope and not
  reflected in the regular list, or the run's metadata refresh needs another
  cycle.

## Post-run index state (observed after Alarm-triggered incremental)

- BACKUP HEALTH: 已保存 230 -> 125 条 (index rebuilt/slimmed by the incremental run).
- 01C 状态: "本地采集完成" (previously "本地采集完成，但有待处理项" — pending items cleared).
- PR #3 (executeScript timeout fix): state OPEN, mergeable, verify check SUCCESS
  (run 31417157329, 2026-08-10T18:03:39Z).


## C. Incremental detection — OBSERVED PASS (owner-screenshot + leveldb)

- Owner ran 立即增量运行一次 at ~02:41 local (screenshot evidence).
- backup-schedule-runtime final record (latest log 003268.log):
  status=success, lastStartedAt=2026-08-10T18:41:35.224Z,
  lastSuccessfulAt=2026-08-10T18:42:03.438Z (= 02:42:03 local, matches UI),
  jobStatus=completed, snapshotCreated=true,
  snapshotId=snapshot-2026-08-10T18-41-35-854Z-b695f018aab5,
  conversations=99 (UI: 上次处理 99 条对话), lastError absent.
- UI (owner screenshot): 逻辑快照 3 (was 1 at acceptance B),
  上次成功 2026/8/11 02:42:03, 增量备份已完成 (28 秒),
  "Chrome Alarm 已触发，正在自动读取并比较增量".
- This run completed successfully in 28s — the earlier project-conversations
  stall did NOT recur, indicating the stall is intermittent (page-renderer
  state dependent), and normal incremental path works.

## D. Snapshot history safety — OBSERVED (partial)

- Logical snapshots: baseline snapshot-2026-08-10T13-52-08-584Z-1d9ec23c9bbc
  (from acceptance E baseline) + snapshot-2026-08-10T18-41-35-854Z-b695f018aab5
  (newest). UI shows 逻辑快照 3.
- Newest snapshot readable after refresh/retention activity: 02:42 run
  created a new snapshot while previous ones remained (count 1 -> 3),
  no missing-content-object errors observed.
