# Real Chrome Acceptance — KV Archive v0.16.9

Run this in the owner's normal Chrome profile after installing v0.16.9.

## 1. Safe index clearing

1. Create or identify a Project with Project State, approved context, a Memory Gate receipt and a local note.
2. Confirm at least one Evidence URI is readable.
3. Open Local Library and choose `清空会话索引`.
4. Confirm the dialog explicitly says Project State, context, Capture Center, Gate receipts and Evidence are preserved.
5. Complete the operation.
6. Verify searchable conversation/message results are cleared.
7. Verify the Project, state versions, proposals, approved context, Gate receipt, note and Evidence URI still exist.

Failure: any governed record or Evidence disappears.

## 2. Large search and conversation detail

1. Search a common term in a large imported library.
2. Confirm result count and `加载更多结果` are usable.
3. Open a long conversation.
4. Confirm the dialog opens immediately and additional messages can be loaded without freezing the page.
5. Rapidly run two different searches; the older response must not replace the newer query.

## 3. Project creation and isolation

1. In Capture Center, enter a new Project name and save a note.
2. Confirm the Project appears in Project State, Project Context and Obsidian.
3. Confirm Project Context contains the note and a `contextvault://content/...revision=...&hash=...` Evidence URI.
4. Save another note; the Project selection should remain.
5. Try two different names that normalize to the same Project ID; the second must be blocked with a rename instruction, not merged.

## 4. History and action closure

- Archived content offers `取消归档`, not another archive action.
- Trash restore and undo return to the true prior state.
- Relationship creation is unavailable until two distinct active records exist.
- Proposals, state versions, memory versions, capture versions, operations, relations and recovery receipts expose load-more controls when over their batch limits.

## 5. Agent export scope and performance

1. Select a Project and apply a screen-only keyword or role filter.
2. Export Agent Bundle.
3. Confirm the warning states keyword/role only filter the screen and do not silently remove Project evidence.
4. Confirm the bundle contains only the selected Project scope and completes without loading/freezing the full vault UI.

## 6. Notes PWA

- When native install prompting is unavailable, `安装说明` gives useful platform instructions.
- `操作与关系` lists actual rows, timestamps and relation endpoints, not only counts.
- Long histories can be loaded incrementally.
- Simulate storage quota failure if practical; the UI must show draft-save failure and must not imply the draft is safe.

Record Chrome version, extension version, account scale, screenshots and any console errors.
