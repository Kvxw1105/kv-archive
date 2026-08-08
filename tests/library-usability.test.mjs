import test from "node:test";
import assert from "node:assert/strict";
import { agentBundleScope, ignoredAgentBundleFilters, pageResultRows, partitionDetailMessages } from "../apps/extension/src/library-ux.js";

test("library result pagination keeps a real continuation path", () => {
  const rows = Array.from({ length: 301 }, (_, index) => ({ index }));
  const first = pageResultRows(rows, 150);
  assert.equal(first.visible.length, 150);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCount, 150);
  const last = pageResultRows(rows, 300);
  assert.equal(last.visible.length, 300);
  assert.equal(last.nextCount, 1);
});

test("long conversation detail is rendered in bounded batches", () => {
  const messages = Array.from({ length: 350 }, (_, index) => ({ id: index, activePath: index < 220 }));
  const first = partitionDetailMessages(messages, 120);
  assert.equal(first.shown, 120);
  assert.equal(first.visibleBranch.length, 0);
  assert.equal(first.hasMore, true);
  const second = partitionDetailMessages(messages, 240);
  assert.equal(second.visibleActive.length, 220);
  assert.equal(second.visibleBranch.length, 20);
});

test("agent bundle scope is honest about ignored screen-only filters", () => {
  const filters = { query: "decision", role: "assistant", projectId: "p1", sourceKind: "all", archived: "active" };
  assert.deepEqual(agentBundleScope(filters), { sourceKind: "all", projectId: "p1", archived: "active", dateFrom: "", dateTo: "" });
  assert.deepEqual(ignoredAgentBundleFilters(filters), ["关键词", "角色"]);
});
