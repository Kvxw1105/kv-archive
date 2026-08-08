# Real Chrome Acceptance — KV Archive v0.16.2

Use a logged-in Chrome profile and a selection large enough to run for several minutes.

## A. Capture and pause

1. Refresh the conversation catalog and select at least 30 conversations, including one long conversation if available.
2. Click “开始采集到浏览器”.
3. After several items show as saved, click “暂停采集”.
4. Confirm the UI explains that it may wait for the current request, with a maximum of about 60 seconds.
5. Confirm saved/remaining/failed counts remain visible and the page becomes operable again.
6. Close and reopen the KV Archive workspace; confirm the same task and saved count return.

## B. Partial local export

1. While the task is paused, click “导出已保存到本地”.
2. Confirm Chrome downloads one or more ZIP volumes.
3. Confirm the filename identifies the archive as partial and includes saved/selected progress.
4. Open the archive manifest and confirm `captureProgress.isPartial` is true and counts match the UI.
5. Confirm exporting did not mark the capture task complete or remove its remaining work.

## C. Pause and export in one action

1. Resume capture.
2. While a conversation is being captured, click “暂停并导出已保存”.
3. Confirm capture safely pauses and then local ZIP download begins automatically.
4. Confirm already saved conversations are present and the currently unfinished conversation is not falsely represented as saved.

## D. Resume and failure isolation

1. Resume the same task and let more conversations finish.
2. Confirm it skips artifacts already saved.
3. If a conversation times out or fails, confirm the batch continues and the item appears in the failed count.
4. Export again and confirm the new partial archive contains the larger durable subset.

## E. Large-list usability

1. Search, filter and scroll the catalog while hundreds of conversations exist.
2. Confirm the page initially renders a bounded subset and “加载更多” reveals additional rows.
3. Confirm selecting hundreds of conversations does not render every selected row at once.

Record screenshots, downloaded filenames, UI counts and any failed conversation title. Do not claim acceptance until all five sections pass.
