# Real Acceptance — KV Archive v0.16.4

Use a real Chrome profile with an authenticated ChatGPT tab.

## A. Establish a baseline

1. Open KV Archive → Backup Center → 定时增量备份.
2. Keep one logged-in ChatGPT tab open.
3. Click `立即增量运行一次`.
4. Wait until the current state is successful and `逻辑快照` is at least 1.

## B. Ten-minute change test

1. Click `开始 10 分钟验收`.
2. Confirm the displayed trigger time is approximately ten minutes ahead.
3. During the window, create a small new ChatGPT conversation or add one message to an existing conversation.
4. The KV Archive page may be closed. Keep Chrome running and keep a logged-in ChatGPT tab available.
5. After the trigger time, reopen Backup Center or wait for its five-second refresh.
6. Pass condition: state is `通过：检测到变化`, `alarmTriggered` is true, and at least one added or updated conversation is reported.

## C. No-change control

Start a second ten-minute acceptance and do not change any conversation. Pass condition: `通过：无内容变化`. This proves the alarm and automatic fetch ran without falsely reporting a change.

## D. Restart/catch-up

Start a test, close Chrome before the due time, then reopen Chrome after the due time with ChatGPT logged in. Record whether the pending test is reconstructed and runs as a catch-up. Device sleep and full browser shutdown may delay the exact firing time.

## E. Failure visibility

Start a test, then close every logged-in ChatGPT tab. Pass condition: the test becomes `验收失败` with a clear missing-tab error and does not silently claim success.

## Release decision

Do not call the scheduler generally released until A–E are recorded. A small invited tester cohort is acceptable after A and B pass on the owner account; broader testing should also include C–E and one real overnight or next-day scheduled run.
