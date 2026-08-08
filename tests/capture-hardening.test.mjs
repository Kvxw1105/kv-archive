import test from "node:test";
import assert from "node:assert/strict";
import {
  computeRestoredScrollTop,
  mergeHydratedMessageBatches,
  normalizeVisibleConversationSnapshot,
  parseStableTurnOrdinal,
} from "../apps/extension/dist/generic-dom-adapter.js";
import {
  analyzeConversationCandidate,
  assessStructuredCaptureConfidence,
  hydrationCorroboratesStructuredCapture,
} from "../apps/extension/dist/network-parser.js";

function rawConversation(messageCount) {
  const mapping = {};
  let parent = null;
  for (let index = 1; index <= messageCount; index += 1) {
    const id = `node-${index}`;
    mapping[id] = {
      parent,
      children: [],
      message: {
        id: `message-${index}`,
        author: { role: index % 2 ? "user" : "assistant" },
        content: { content_type: "text", parts: [`message ${index}`] },
        status: "finished_successfully",
        metadata: {},
      },
    };
    if (parent) mapping[parent].children.push(id);
    parent = id;
  }
  return {
    id: "conversation-hardening",
    title: "Hardening",
    current_node: parent,
    mapping,
  };
}

test("small structurally self-consistent trees require page corroboration", () => {
  const candidate = analyzeConversationCandidate(rawConversation(2), {
    expectedId: "conversation-hardening",
    responseUrl: "/backend-api/conversation/conversation-hardening",
  });
  const confidence = assessStructuredCaptureConfidence(candidate, {
    initialVisibleMessages: 2,
    maxStableTurnOrdinal: 48,
    lastStableId: "conversation-turn-48",
  });
  assert.equal(confidence.confident, false);
  assert.equal(confidence.needsHydration, true);
  assert.ok(confidence.reasons.includes("BELOW_PAGE_TURN_LOWER_BOUND"));
  assert.ok(confidence.reasons.includes("SMALL_BRANCH_REQUIRES_CORROBORATION"));
});

test("large continuous structured trees remain confident without forced DOM scrolling", () => {
  const candidate = analyzeConversationCandidate(rawConversation(100), {
    expectedId: "conversation-hardening",
    responseUrl: "/backend-api/conversation/conversation-hardening",
  });
  const confidence = assessStructuredCaptureConfidence(candidate, {
    initialVisibleMessages: 2,
    maxStableTurnOrdinal: 99,
  });
  assert.equal(confidence.confident, true);
  assert.equal(confidence.needsHydration, false);
  assert.deepEqual(confidence.reasons, []);
});

test("small trees become verified only after a complete matching hydration pass", () => {
  const candidate = analyzeConversationCandidate(rawConversation(2), {
    expectedId: "conversation-hardening",
    responseUrl: "/backend-api/conversation/conversation-hardening",
  });
  assert.equal(hydrationCorroboratesStructuredCapture(candidate, {
    hydrationComplete: true,
    maxStableTurnOrdinal: 2,
  }, 2), true);
  assert.equal(hydrationCorroboratesStructuredCapture(candidate, {
    hydrationComplete: false,
    maxStableTurnOrdinal: 2,
  }, 2), false);
  assert.equal(hydrationCorroboratesStructuredCapture(candidate, {
    hydrationComplete: true,
    maxStableTurnOrdinal: 20,
  }, 20), false);
});

test("role-less virtual windows merge before global role parity is inferred", () => {
  const merged = mergeHydratedMessageBatches([
    [
      { role: "unknown", text: "message 3" },
      { role: "unknown", text: "message 4" },
    ],
    [
      { role: "unknown", text: "message 1" },
      { role: "unknown", text: "message 2" },
      { role: "unknown", text: "message 3" },
    ],
  ]);
  assert.deepEqual(merged.map((item) => item.text), ["message 1", "message 2", "message 3", "message 4"]);
  const canonical = normalizeVisibleConversationSnapshot({
    title: "Roleless",
    messages: merged,
  });
  assert.deepEqual(canonical.activePath.map((id) => canonical.nodes[id].role), ["user", "assistant", "user", "assistant"]);
});

test("scroll restoration preserves distance from bottom when viewport size changes", () => {
  const restored = computeRestoredScrollTop({
    initialScrollHeight: 10_000,
    initialClientHeight: 800,
    initialScrollTop: 8_900,
    finalScrollHeight: 15_000,
    finalClientHeight: 700,
  });
  assert.equal(restored, 14_000);
});

test("stable turn ordinals are parsed conservatively", () => {
  assert.equal(parseStableTurnOrdinal("conversation-turn-47"), 47);
  assert.equal(parseStableTurnOrdinal("turn_12-extra"), 12);
  assert.equal(parseStableTurnOrdinal("message-abc"), null);
});
