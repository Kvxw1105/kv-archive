# KV Archive v0.13.1 Real Browser Acceptance

Use this checklist only after installing the unpacked v0.13.1 extension in a real Chrome profile. Record screenshots or short notes for failures, but do not include access tokens, cookies, signed URLs or private conversation text.

## A. Upgrade and data preservation

1. Confirm the previous extension data exists.
2. Replace the unpacked extension directory with v0.13.1 and reload it.
3. Open Backup Center, Library, Project State, Memory, Obsidian and Conversation Basket.
4. Confirm old conversations, tasks, snapshots, state versions and memory versions remain present.
5. Confirm no database reset prompt appears.

Pass condition: IndexedDB upgrades to version 9 without loss.

## B. Existing ChatGPT current conversation

1. Open a real `chatgpt.com/c/...` conversation with code, links and at least one branch or rich element.
2. Save it to the local Library.
3. Download readable HTML and technical ZIP separately.
4. Confirm the structured capture still reports the expected conversation and content modes.

Pass condition: no regression from v0.13.0.

## C. Conversation Basket

1. Keep a logged-in ChatGPT tab open.
2. Open `会话篮子` and click `读取会话目录`.
3. Confirm ordinary, archived and Project conversations appear.
4. Search by title and filter by one Project.
5. Select at least three non-adjacent conversations.
6. Save the selection set.
7. Export with `references-only`.
8. Inspect the ZIP index and verify only the selected conversations are present.
9. Repeat with one conversation expected to fail or interrupt the task by closing the Basket, then reopen and continue.
10. Repeat with attachment download enabled only when acceptable.

Pass condition: selection survives, completed items are not repeated, failures are isolated, and every exported conversation has a completeness record.

## D. Visible-only provider capture

Run at least one real conversation on Gemini and DeepSeek, then optionally other registered providers.

1. Open the conversation and ensure its messages are rendered.
2. Click KV Archive.
3. Confirm the popup says `可见内容` rather than `完整历史`.
4. Save to Library and download HTML.
5. Compare the output with what was visibly rendered.
6. Confirm the integrity result is `PARTIAL` or carries `VISIBLE_ONLY_CAPTURE`.

Pass condition: visible messages are preserved and the UI never claims hidden history or attachment completeness.

## E. Unknown-site generic mode

1. Open an AI chat website not in the Provider Registry.
2. Confirm KV Archive does not automatically enable normal saving.
3. Click `尝试通用网页对话模式`.
4. Save the page.
5. Confirm failure is explicit if no conversation blocks can be identified.

Pass condition: generic capture only runs after user intent and remains visible-only.

## F. Failure and recovery

- Log out before reading a ChatGPT catalog.
- Revoke a temporary asset URL.
- Interrupt a selected export.
- Reload the extension during a saved selection.
- Attempt to save a normal `x.com` page.

Pass condition: no false success, no deletion of source-platform data, no silent loss of already completed records, and ordinary X pages are not presented as Grok conversations.

## Acceptance status template

```text
Chrome version:
Extension install mode:
Previous version upgraded from:
ChatGPT catalog result:
Selected export count:
Gemini visible capture:
DeepSeek visible capture:
Generic unknown-site capture:
Attachment policy tested:
Data preservation result:
Overall: PASS / PARTIAL / FAIL
Remaining blockers:
```
