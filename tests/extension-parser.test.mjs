import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  analyzeConversationCandidate,
  chooseBestConversationCandidate,
  conversationIdFromUrl,
  findConversationObject,
  parseConversationCandidates,
  parseConversationResponse,
} from "../apps/extension/src/network-parser.js";

const conversation = {
  id: "abc-123",
  current_node: "node-1",
  mapping: { "node-1": { parent: null, children: [], message: null } },
};

test("finds a nested conversation object", () => {
  assert.equal(findConversationObject({ wrapper: { payload: conversation } }), conversation);
});

test("parses SSE-wrapped conversation JSON", () => {
  const body = `event: message\ndata: ${JSON.stringify({ payload: conversation })}\ndata: [DONE]`;
  assert.deepEqual(parseConversationResponse(body), conversation);
});

test("extracts a current conversation ID from ChatGPT URLs", () => {
  assert.equal(conversationIdFromUrl("https://chatgpt.com/c/abc-123?model=x"), "abc-123");
  assert.equal(conversationIdFromUrl("https://chatgpt.com/g/g-p-project/c/abc-123"), "abc-123");
  assert.equal(conversationIdFromUrl("https://chatgpt.com/"), null);
});


function longConversation(id, turns) {
  const mapping = { root: { parent: null, children: ["u-1"], message: null } };
  let parent = "root";
  for (let index = 1; index <= turns; index += 1) {
    const userId = `u-${index}`;
    const assistantId = `a-${index}`;
    mapping[userId] = {
      parent,
      children: [assistantId],
      message: { id: `m-${userId}`, author: { role: "user" }, content: { content_type: "text", parts: [`user ${index}`] } },
    };
    mapping[assistantId] = {
      parent: userId,
      children: index < turns ? [`u-${index + 1}`] : [],
      message: { id: `m-${assistantId}`, author: { role: "assistant" }, content: { content_type: "text", parts: [`answer ${index}`] } },
    };
    parent = assistantId;
  }
  return { id, current_node: parent, mapping };
}

test("chooses the complete same-ID conversation instead of the first last-turn event package", () => {
  const partial = longConversation("abc-123", 1);
  const complete = longConversation("abc-123", 50);
  const body = JSON.stringify({ events: [{ payload: partial }, { payload: complete }] });
  const candidates = parseConversationCandidates(body, { expectedId: "abc-123" });
  assert.equal(candidates.length, 2);
  const best = chooseBestConversationCandidate(candidates, { expectedId: "abc-123" });
  assert.equal(best.activePathMessages, 100);
  assert.deepEqual(parseConversationResponse(body, { expectedId: "abc-123" }), complete);
});

test("candidate diagnostics reject wrong IDs and broken parent chains", () => {
  const complete = longConversation("abc-123", 2);
  const wrong = analyzeConversationCandidate(complete, { expectedId: "other" });
  assert.equal(wrong.exactId, false);
  assert.equal(chooseBestConversationCandidate([wrong], { expectedId: "other" }), null);

  const broken = structuredClone(complete);
  delete broken.mapping[broken.mapping[broken.current_node].parent];
  const analysis = analyzeConversationCandidate(broken, { expectedId: "abc-123" });
  assert.equal(analysis.rootReached, false);
  assert.equal(analysis.parentBreaks, 1);
});


test("current ChatGPT export prefers the authoritative conversation API and downgrades uncertain debugger fallback", async () => {
  const background = await readFile("apps/extension/src/background.js", "utf8");
  assert.match(background, /createChatGPTTransport\(tabId\)\.fetchConversation\(expectedId\)/);
  assert.match(background, /chatgpt-authoritative-conversation-api/);
  assert.match(background, /chromium-debugger-network-fallback/);
  assert.match(background, /: "unknown"/);
  assert.doesNotMatch(background, /adapter: "chromium-debugger-network",[\s\S]{0,160}completeness: "verified"/);
  assert.match(background, /chatgpt-dom-history-hydrator/);
  assert.match(background, /visibleCount > structuredCount/);
  assert.doesNotMatch(background, /chatgpt\.com\|chat\.openai\.com\)\\\/c/);
});


test("current export downloads one artifact and preserves hydration iteration diagnostics", async () => {
  const background = await readFile("apps/extension/src/background.js", "utf8");
  const downloadCalls = background.match(/downloadId = await download\(artifact\.filename/g) ?? [];
  assert.equal(downloadCalls.length, 1);
  assert.match(background, /captureDiagnostics\.hydrationIterations \?\? captureDiagnostics\.iterations/);
});
