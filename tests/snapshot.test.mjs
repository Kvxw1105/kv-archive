import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { normalizeChatGPTConversation } from "../dist/packages/normalizer/src/index.js";
import { renderActivePathMarkdown } from "../dist/packages/renderers/src/index.js";

const fixture = JSON.parse(await readFile("fixtures/synthetic/multi-branch-conversation.json", "utf8"));
const expected = `# ContextVault Synthetic Branch Test

- Conversation ID: conv-synthetic-001
- Schema: 0.2
- Export mode: conversation
- Active path messages: 2
- Total graph nodes: 5

## 1. User

Please show a deterministic TypeScript example.

## 2. Assistant

Here is the active answer.

\`\`\`ts
const stable = true;
\`\`\`
`;

test("active path Markdown is deterministic", () => {
  const canonical = normalizeChatGPTConversation(fixture);
  assert.equal(renderActivePathMarkdown(canonical), expected);
});
