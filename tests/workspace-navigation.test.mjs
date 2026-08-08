import test from "node:test";
import assert from "node:assert/strict";
import { isWorkspaceTabUrl, openWorkspacePage, pickWorkspaceTab } from "../apps/extension/src/workspace-navigation.js";

const runtimeBase = "chrome-extension://abc123/";

test("workspace navigation recognizes only KV Archive full-page surfaces", () => {
  assert.equal(isWorkspaceTabUrl(`${runtimeBase}library.html`, runtimeBase), true);
  assert.equal(isWorkspaceTabUrl(`${runtimeBase}memory.html?from=popup`, runtimeBase), true);
  assert.equal(isWorkspaceTabUrl(`${runtimeBase}popup.html`, runtimeBase), false);
  assert.equal(isWorkspaceTabUrl("https://chatgpt.com/", runtimeBase), false);
});

test("workspace navigation prefers the active existing workspace tab", () => {
  const chosen = pickWorkspaceTab([
    { id: 1, url: `${runtimeBase}backup.html`, active: false, lastAccessed: 20 },
    { id: 2, url: `${runtimeBase}library.html`, active: true, lastAccessed: 10 },
    { id: 3, url: "https://chatgpt.com/", active: true, lastAccessed: 30 },
  ], runtimeBase);
  assert.equal(chosen.id, 2);
});

test("popup navigation reuses one workspace tab instead of creating another", async () => {
  const calls = [];
  const chromeApi = {
    runtime: { getURL: (file) => `${runtimeBase}${file}` },
    tabs: {
      async query() { return [{ id: 7, url: `${runtimeBase}backup.html`, active: false }]; },
      async update(id, value) { calls.push(["update", id, value]); return { id, ...value }; },
      async create(value) { calls.push(["create", value]); return { id: 8, ...value }; },
    },
  };
  const result = await openWorkspacePage(chromeApi, "memory.html");
  assert.equal(result.mode, "reused");
  assert.deepEqual(calls, [["update", 7, { url: `${runtimeBase}memory.html`, active: true }]]);
});

test("popup navigation creates a workspace tab only when none exists", async () => {
  const calls = [];
  const chromeApi = {
    runtime: { getURL: (file) => `${runtimeBase}${file}` },
    tabs: {
      async query() { return [{ id: 1, url: "https://chatgpt.com/" }]; },
      async update() { throw new Error("should not update"); },
      async create(value) { calls.push(value); return { id: 9, ...value }; },
    },
  };
  const result = await openWorkspacePage(chromeApi, "basket.html");
  assert.equal(result.mode, "created");
  assert.deepEqual(calls, [{ url: `${runtimeBase}basket.html` }]);
});
