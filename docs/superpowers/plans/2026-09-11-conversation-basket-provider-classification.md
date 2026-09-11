# Conversation Basket Provider Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not spawn subagents; this plan is intentionally detailed enough for one executor.

**Goal:** Let Conversation Basket group and filter locally cached conversation catalogs by real AI platform without weakening existing ChatGPT selection/export behavior.

**Architecture:** Aggregate the existing per-provider `conversationCatalogs` cache records into a presentation-only Basket catalog. Namespace collection filters with the provider ID; retain all existing reference keys. ChatGPT remains the only verified full-history/batch provider: other cached provider records can be inspected and selected, but unsupported or mixed-platform batches stop before the ChatGPT-only engine.

**Tech Stack:** Vanilla ES modules, Chrome MV3, IndexedDB v13 unchanged, Node.js `node:test`, npm.

---

## Scope and protected work

- Do not add a new IndexedDB store/version, platform scraper, or fake empty provider category.
- Do not claim a provider supports full-history capture solely because it appears in the registry or cache.
- Preserve Raw Evidence, existing selection keys/fingerprints, and the user-owned unstaged `tests/pwa.test.mjs` change.
- Use the current branch and PR #3; commit/push only scoped work; never merge or release.

## File map

- Create `apps/extension/src/conversation-catalog-view.js`: pure aggregation, collision-safe collection keys, provider capture eligibility.
- Create `tests/conversation-catalog-view.test.mjs`: aggregation and eligibility tests.
- Modify `apps/extension/src/conversation-selection.js`: optional provider-qualified collection filtering.
- Modify `apps/extension/src/basket.html`, `basket.css`, `basket.js`: filter, badges, restore-all-cache, truthful capture gate.
- Modify `tests/conversation-selection.test.mjs`, `tests/ui-shell.test.mjs`, state/handoff docs.

### Task 1: Create failing provider-catalog behavior tests

**Files:**
- Create: `tests/conversation-catalog-view.test.mjs`
- Modify: `tests/conversation-selection.test.mjs`

- [x] **Step 1: Write the aggregation test**

Create `tests/conversation-catalog-view.test.mjs` with two cache records: ChatGPT and Gemini, both having a `shared` collection ID and one conversation each. Assert that `buildBasketCatalog(records)` returns two conversations, provider counts `chatgpt:1` and `gemini:1`, collection keys `chatgpt:shared` and `gemini:shared`, and a Gemini display label. Assert `captureEligibility([{ provider: "chatgpt" }])` returns `{ eligible: true, provider: "chatgpt" }`; Gemini returns `{ eligible: false, reason: "Gemini 暂不支持批量完整会话采集。" }`; a mixed array returns `{ eligible: false, reason: "当前批次包含多个平台；请按平台分别采集。" }`.

- [x] **Step 2: Extend the selection regression test**

Append this test to `tests/conversation-selection.test.mjs`:

```js
test("selection filters preserve platform identity", () => {
  const mixed = [...refs, { provider: "gemini", accountScopeId: "personal", conversationId: "g-1", title: "Gemini note", updatedAt: 1 }];
  assert.deepEqual(filterConversationRefs(mixed, "", { provider: "gemini" }).map((item) => item.key), ["gemini:personal:g-1"]);
  assert.deepEqual(new Set(createConversationSelectionSet({ title: "Mixed", refs: mixed }).items.map((item) => item.provider)), new Set(["chatgpt", "gemini"]));
});
```

- [x] **Step 3: Verify RED**

Run `node --test tests/conversation-catalog-view.test.mjs tests/conversation-selection.test.mjs`.

Expected: module-not-found failure for `conversation-catalog-view.js`; the selection test may pass because provider identity already exists.

### Task 2: Build the pure aggregate model

**Files:**
- Create: `apps/extension/src/conversation-catalog-view.js`
- Modify: `apps/extension/src/conversation-selection.js`

- [x] **Step 1: Implement `buildBasketCatalog` and `captureEligibility`**

Create `conversation-catalog-view.js`. Import `getProviderDefinition`/`providerSupports` from `provider-registry.js` and `normalizeConversationRef` from `conversation-selection.js`. `buildBasketCatalog(records)` must ignore invalid records, flatten record catalogs, force each ref's provider/account scope from its record when absent, add `providerLabel`, sort conversations by newest update, create `{ id, label, count }` provider models, and create `{ key: `${provider}:${collectionId}`, provider, providerLabel, collectionId, title }` collection models. Export `basketCollectionKey(provider, collectionId)` for the same key rule.

`captureEligibility(refs)` must: return `{ eligible:false, reason:"还没有选择会话。" }` for zero refs; reject more than one provider with `当前批次包含多个平台；请按平台分别采集。`; return `{ eligible:true, provider }` only when `providerSupports(provider, "batchSelection", ["verified"])`; otherwise return `${displayName} 暂不支持批量完整会话采集。`.

- [x] **Step 2: Add qualified collection filtering without breaking callers**

In `filterConversationRefs`, retain `options.collectionId`. Add `const collectionKey = cleanText(options.collectionKey);` and, after provider filtering, reject a ref if `collectionKey` is present and neither its primary collection nor any `collectionRefs` value satisfies ```${ref.provider}:${id} === collectionKey```.

- [x] **Step 3: Verify GREEN**

Run `node --test tests/conversation-catalog-view.test.mjs tests/conversation-selection.test.mjs` and require all pass.

### Task 3: Connect the Basket UI to every real cached provider catalog

**Files:**
- Modify: `apps/extension/src/basket.html`
- Modify: `apps/extension/src/basket.css`
- Modify: `apps/extension/src/basket.js`
- Modify: `tests/ui-shell.test.mjs`

- [x] **Step 1: Lock the UI contract with a failing test**

Append:

```js
test("Conversation Basket exposes a real provider filter", async () => {
  const basket = await readFile("apps/extension/src/basket.html", "utf8");
  assert.match(basket, /id="provider"/);
  assert.match(basket, /全部平台/);
  assert.match(basket, /按平台分别采集/);
});
```

Run `node --test tests/ui-shell.test.mjs`; expect failure.

- [x] **Step 2: Add the provider filter and responsive style**

Add `<select id="provider" aria-label="平台筛选"><option value="">全部平台</option></select>` as the first `.basket-filters` control. Update the explanatory paragraph to say that cached complete conversations can be filtered by platform, project, and state; ChatGPT supports batch capture now; other platforms display only after a real catalog/import record exists and must be captured per platform.

Change `.basket-filters` desktop grid to `minmax(160px,.32fr) minmax(240px,1fr) minmax(180px,.45fr) minmax(140px,.3fr)`. Keep the existing narrow one-column rule. Add `.conversation-provider { color:var(--kv-accent); font:10px/1 var(--kv-mono); text-transform:uppercase; }`.

- [x] **Step 3: Restore, filter, and display all cached providers**

Import `buildBasketCatalog` and `captureEligibility`. Add `provider` to `elements`; persist/restore it in `UI_PREFS_KEY`. In `restoreBasketState`, replace `catalogStore.getLatest("chatgpt")` with `catalogStore.list()`, build the aggregate, and populate only if it has conversations.

In `populateCatalogView`, render provider options from `catalog.providers`, with persisted-value validation; render collection option value `item.key` and label `${item.providerLabel} · ${item.title}`. In `applyFilters`, call `filterConversationRefs(catalog.conversations, elements.query.value, { provider: elements.provider.value, collectionKey: elements.collection.value })`, then retain current active/archived filtering. Register the provider change listener.

In `renderAvailable`, retain date/project metadata and add a `.conversation-provider` span using `ref.providerLabel`; show the provider label as the existing right-side badge. Do not hide archive/project state.

- [x] **Step 4: Keep refresh truthful and preserve other caches**

After ChatGPT refresh succeeds: `await catalogStore.put(freshCatalog)`, then `const aggregate = buildBasketCatalog(await catalogStore.list())` and render it. Do not alter `createChatGPTTransport`, `loadChatGPTConversationCatalog`, or refresh feedback: it must continue to identify ChatGPT rather than imply all platforms refreshed.

- [x] **Step 5: Prevent unsupported/mixed selections from entering capture**

At the start of `runCapture()`, before task feedback, add:

```js
const eligibility = captureEligibility(selection.items);
if (!eligibility.eligible) {
  setStatus(eligibility.reason, "warning");
  return;
}
```

Replace the three hard-coded `provider: "chatgpt"` arguments in `selectionForSave`, select-visible, and clear-selection with `provider: null` and `accountScopeId: null`, allowing `createConversationSelectionSet` to derive a shared provider/scope only when truthful.

- [x] **Step 6: Run focused regression tests**

Run `node --test tests/conversation-catalog-view.test.mjs tests/conversation-selection.test.mjs tests/conversation-catalog-cache.test.mjs tests/ui-shell.test.mjs tests/ui-visibility.test.mjs`.

Expected: all pass; ChatGPT cache still works; two provider records display collision-safe filters; unsupported/mixed selection never reaches the ChatGPT engine.

### Task 4: Verify, record, and deliver the scoped change

**Files:**
- Modify: `.agent-harness/CURRENT_STATE.md`
- Modify: `.agent-harness/HANDOFF.md`
- Preserve unstaged: `tests/pwa.test.mjs`

- [x] **Step 1: Run complete local verification once**

Run:

```powershell
npm run typecheck
npm run build:extension
npm test
```

Require manifest version `0.16.11` and all deterministic tests pass.

- [x] **Step 2: Review safety and update state**

Run `git status --short`, `git diff --check`, and a scoped `git diff`. Confirm `tests/pwa.test.mjs` remains unstaged. Add this milestone to both state files:

```text
Conversation Basket now restores every locally cached provider catalog and offers platform-aware grouping/filtering. ChatGPT remains the only verified batch full-history collector; unsupported or mixed-platform selections stop with an explicit explanation instead of entering the ChatGPT-only engine. IndexedDB v13 and existing selection keys remain unchanged.
```

- [x] **Step 3: Commit, push, and verify PR #3**

Stage only Basket source, the aggregate module, scoped tests, state/handoff, and this plan. Commit `feat: classify basket conversations by provider`, push `fix/stuck-project-conversation-indexing`, confirm PR #3 head matches local HEAD, and wait for `gh pr checks 3 --repo Kvxw1105/kv-archive --watch` to report `verify` success. Do not merge or release.
