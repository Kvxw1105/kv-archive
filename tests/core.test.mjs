import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { normalizeChatGPTConversation } from "../dist/packages/normalizer/src/index.js";
import { validateCanonicalConversation } from "../dist/packages/domain/src/index.js";
import { generateIntegrityReport } from "../dist/packages/integrity/src/index.js";

const fixture = JSON.parse(await readFile("fixtures/synthetic/multi-branch-conversation.json", "utf8"));

test("normalizes a complete graph and reconstructs the active path", () => {
  const canonical = normalizeChatGPTConversation(fixture);
  assert.deepEqual(canonical.activePath, ["user-1", "assistant-active"]);
  assert.equal(Object.keys(canonical.nodes).length, 5);
  assert.ok(canonical.nodes["assistant-history"]);
  assert.equal(validateCanonicalConversation(canonical).ok, true);
});

test("preserves unknown content as raw payload", () => {
  const canonical = normalizeChatGPTConversation(fixture);
  const activeUnknown = canonical.nodes["assistant-active"].content.find((part) => part.type === "unknown");
  assert.ok(activeUnknown);
  assert.equal(activeUnknown.sourceType, "future_widget");
  assert.deepEqual(activeUnknown.rawPayload.payload, { value: 42 });
});

test("reports orphan nodes and branch nodes without dropping them", () => {
  const canonical = normalizeChatGPTConversation(fixture);
  const report = generateIntegrityReport(canonical);
  assert.equal(report.status, "PARTIAL");
  assert.deepEqual(report.orphanNodeIds, ["orphan"]);
  assert.equal(report.branchNodes, 2);
  assert.equal(report.unknownContentTypes, 2);
});


function buildLongRawConversation(turns = 50) {
  const mapping = { root: { parent: null, children: ["user-1"], message: null } };
  let parent = "root";
  for (let index = 1; index <= turns; index += 1) {
    const userId = `user-${index}`;
    const answerId = `answer-${index}`;
    mapping[userId] = {
      parent,
      children: [answerId],
      message: {
        id: `message-${userId}`,
        author: { role: "user" },
        content: { content_type: "text", parts: [`Question ${index}`] },
        metadata: {},
      },
    };
    mapping[answerId] = {
      parent: userId,
      children: index < turns ? [`user-${index + 1}`] : [],
      message: {
        id: `message-${answerId}`,
        author: { role: "assistant" },
        content: { content_type: "text", parts: [`Answer ${index}`] },
        metadata: {},
      },
    };
    parent = answerId;
  }
  return { id: "long-50-turns", title: "Long test", current_node: parent, mapping };
}

test("a verified 50-turn branch remains complete without relying on rendered DOM history", () => {
  const canonical = normalizeChatGPTConversation(buildLongRawConversation(50), {
    adapter: "authoritative-test",
    captureMode: "structured",
    completeness: "verified",
  });
  const report = generateIntegrityReport(canonical);
  assert.equal(canonical.activePath.length, 100);
  assert.equal(report.userMessages, 50);
  assert.equal(report.assistantFinalMessages, 50);
  assert.equal(report.renderableConversationMessages, 100);
  assert.equal(report.rootReached, true);
  assert.equal(report.activePathContinuous, true);
  assert.equal(report.status, "COMPLETE");
});

test("unverified capture sources and broken parent chains cannot claim COMPLETE", () => {
  const unknownSource = normalizeChatGPTConversation(buildLongRawConversation(2), {
    adapter: "debugger-fallback",
    captureMode: "structured",
    completeness: "unknown",
  });
  assert.equal(generateIntegrityReport(unknownSource).status, "PARTIAL");

  const broken = normalizeChatGPTConversation(buildLongRawConversation(2), {
    adapter: "authoritative-test",
    captureMode: "structured",
    completeness: "verified",
  });
  const parentId = broken.nodes[broken.currentNodeId].parentId;
  delete broken.nodes[parentId];
  const report = generateIntegrityReport(broken);
  assert.equal(report.status, "PARTIAL");
  assert.equal(report.rootReached, false);
  assert.ok(report.issues.some((issue) => ["MISSING_PARENT", "ROOT_NOT_REACHED", "ACTIVE_PATH_MISMATCH"].includes(issue.code)));
});
