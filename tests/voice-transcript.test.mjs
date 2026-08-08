import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { normalizeChatGPTConversation } from "../dist/packages/normalizer/src/index.js";
import { generateIntegrityReport } from "../dist/packages/integrity/src/index.js";
import { renderActivePathMarkdown, renderReadableHtml } from "../dist/packages/renderers/src/index.js";
import { normalizeVisibleConversationSnapshot } from "../apps/extension/dist/generic-dom-adapter.js";

function voiceConversation() {
  const mapping = {};
  const add = (id, parent, role, content, metadata = {}) => {
    mapping[id] = {
      parent,
      children: [],
      message: {
        id: `message-${id}`,
        author: { role },
        content,
        metadata,
        status: "finished_successfully",
        create_time: 1,
      },
    };
    if (parent) mapping[parent].children.push(id);
  };
  add("user-voice", null, "user", {
    content_type: "audio_transcript",
    parts: [{ type: "transcript", transcript: "这是用户通过 Live 说出的第一句话。", audio_url: "https://private.example/user.wav" }],
  }, { voice_mode: true, audio_asset_id: "private-user-audio" });
  add("assistant-voice", "user-voice", "assistant", {
    content_type: "multimodal_text",
    parts: ["这是 ChatGPT 在 Live 中说出的回答。"],
  }, { message_type: "realtime_response", output_modality: "audio" });
  add("user-text", "assistant-voice", "user", {
    content_type: "text",
    parts: ["这是随后发送的普通文字。"],
  });
  add("assistant-final", "user-text", "assistant", {
    content_type: "text",
    parts: ["这是普通文字模式的最终回答。"],
  });
  return {
    id: "voice-transcript-conversation",
    title: "Voice transcript regression",
    current_node: "assistant-final",
    mapping,
  };
}

test("structured Voice and Live transcript messages normalize as user-visible conversation messages", () => {
  const canonical = normalizeChatGPTConversation(voiceConversation(), {
    adapter: "voice-fixture",
    captureMode: "structured",
    completeness: "verified",
  });
  assert.deepEqual(canonical.activePath.map((id) => canonical.nodes[id].semanticType), [
    "user_voice_transcript",
    "assistant_voice_transcript",
    "user",
    "assistant_final",
  ]);
  assert.equal(canonical.nodes["user-voice"].content[0].type, "text");
  assert.equal(canonical.nodes["user-voice"].content[0].text, "这是用户通过 Live 说出的第一句话。");
  assert.equal(canonical.nodes["assistant-voice"].content[0].text, "这是 ChatGPT 在 Live 中说出的回答。");
  assert.equal(canonical.nodes["user-voice"].metadata.kvArchiveVoiceTranscript, true);
  assert.equal(canonical.nodes["assistant-voice"].metadata.kvArchiveVoiceTranscript, true);
});

test("compact exports preserve Voice transcripts but omit audio metadata and technical payloads", () => {
  const canonical = normalizeChatGPTConversation(voiceConversation(), {
    adapter: "voice-fixture",
    captureMode: "structured",
    completeness: "verified",
  });
  const html = renderReadableHtml(canonical, { integrityStatus: "COMPLETE" });
  const markdown = renderActivePathMarkdown(canonical);
  assert.match(html, /这是用户通过 Live 说出的第一句话/);
  assert.match(html, /这是 ChatGPT 在 Live 中说出的回答/);
  assert.match(html, /这是随后发送的普通文字/);
  assert.match(html, /这是普通文字模式的最终回答/);
  assert.doesNotMatch(html, /private-user-audio|private\.example|语音转录/);
  assert.doesNotMatch(markdown, /private-user-audio|private\.example/);
  assert.equal((html.match(/<article /g) ?? []).length, 4);
});

test("technical exports label Voice transcript messages without exposing raw audio URLs", () => {
  const canonical = normalizeChatGPTConversation(voiceConversation());
  const html = renderReadableHtml(canonical, { integrityStatus: "COMPLETE", mode: "technical" });
  assert.equal((html.match(/voice-transcript-badge/g) ?? []).length >= 2, true);
  assert.match(html, /语音转录/);
  assert.doesNotMatch(html, /https:\/\/private\.example\/user\.wav/);
});

test("integrity counts Voice transcripts as ordinary user and final assistant messages", () => {
  const canonical = normalizeChatGPTConversation(voiceConversation(), { completeness: "verified" });
  const report = generateIntegrityReport(canonical);
  assert.equal(report.userMessages, 2);
  assert.equal(report.assistantFinalMessages, 2);
  assert.equal(report.userVoiceTranscriptMessages, 1);
  assert.equal(report.assistantVoiceTranscriptMessages, 1);
  assert.equal(report.renderableConversationMessages, 4);
  assert.equal(report.unrecognizedActiveNodes, 0);
  assert.equal(report.status, "COMPLETE");
});

test("visible-only Voice transcript snapshots preserve semantic role without parity guessing", () => {
  const canonical = normalizeVisibleConversationSnapshot({
    title: "Visible voice",
    messages: [
      { role: "unknown", semanticType: "user_voice_transcript", text: "灰色的用户语音转录", metadata: { voiceTranscript: true } },
      { role: "unknown", semanticType: "assistant_voice_transcript", text: "灰色的助手语音转录", metadata: { voiceTranscript: true } },
    ],
  });
  assert.deepEqual(canonical.activePath.map((id) => canonical.nodes[id].role), ["user", "assistant"]);
  assert.deepEqual(canonical.activePath.map((id) => canonical.nodes[id].semanticType), ["user_voice_transcript", "assistant_voice_transcript"]);
});

test("DOM capture source includes dedicated Voice and transcript selectors", async () => {
  const source = await readFile("apps/extension/src/generic-dom-adapter.js", "utf8");
  assert.match(source, /data-message-type\*=\\?"voice/);
  assert.match(source, /data-testid\*=\\?"transcript/);
  assert.match(source, /user_voice_transcript/);
  assert.match(source, /assistant_voice_transcript/);
});

test("nested transcript payloads are extracted while audio-only messages remain non-transcript", () => {
  const raw = {
    id: "voice-nested",
    title: "Nested voice payload",
    current_node: "audio-only",
    mapping: {
      voice: {
        parent: null,
        children: ["audio-only"],
        message: {
          id: "message-voice",
          author: { role: "user" },
          content: {
            content_type: "input_audio",
            parts: [{ type: "input_audio", transcript: { text: "嵌套语音转录正文" }, audio_url: "https://private.example/input.wav" }],
          },
          metadata: {},
          status: "finished_successfully",
        },
      },
      "audio-only": {
        parent: "voice",
        children: [],
        message: {
          id: "message-audio-only",
          author: { role: "user" },
          content: {
            content_type: "audio",
            parts: [{ type: "audio_asset_pointer", url: "https://private.example/no-transcript.wav" }],
          },
          metadata: {},
          status: "finished_successfully",
        },
      },
    },
  };
  const canonical = normalizeChatGPTConversation(raw);
  assert.equal(canonical.nodes.voice.semanticType, "user_voice_transcript");
  assert.equal(canonical.nodes.voice.content[0].text, "嵌套语音转录正文");
  assert.equal(canonical.nodes["audio-only"].semanticType, "user");
  const html = renderReadableHtml(canonical, { integrityStatus: "PARTIAL" });
  assert.match(html, /嵌套语音转录正文/);
  assert.doesNotMatch(html, /private\.example|no-transcript/);
});

test("streaming Voice transcript fragments coalesce into one final visible message", () => {
  const canonical = normalizeChatGPTConversation({
    id: "voice-stream",
    title: "Voice stream",
    current_node: "voice-2",
    mapping: {
      user: {
        parent: null,
        children: ["voice-1"],
        message: {
          id: "user-message",
          author: { role: "user" },
          content: { content_type: "text", parts: ["开始语音"] },
          metadata: {},
          status: "finished_successfully",
        },
      },
      "voice-1": {
        parent: "user",
        children: ["voice-2"],
        message: {
          id: "same-voice-message",
          author: { role: "assistant" },
          content: { content_type: "audio_transcript", parts: [{ transcript: "这是一段" }] },
          metadata: { stream_group_id: "voice-stream-group", output_modality: "audio" },
          status: "streaming",
        },
      },
      "voice-2": {
        parent: "voice-1",
        children: [],
        message: {
          id: "same-voice-message",
          author: { role: "assistant" },
          content: { content_type: "audio_transcript", parts: [{ transcript: "这是一段完整的语音回答" }] },
          metadata: { stream_group_id: "voice-stream-group", output_modality: "audio" },
          status: "finished_successfully",
        },
      },
    },
  });
  const html = renderReadableHtml(canonical, { integrityStatus: "COMPLETE" });
  assert.equal((html.match(/data-semantic-type="assistant_voice_transcript"/g) ?? []).length, 1);
  assert.equal((html.match(/这是一段完整的语音回答/g) ?? []).length, 1);
});

test("A-to-D diagnostics report Voice transcript counts", () => {
  const canonical = normalizeChatGPTConversation(voiceConversation());
  const html = renderReadableHtml(canonical, {
    integrityStatus: "PARTIAL",
    diagnostics: {
      rawSourceNodes: 4,
      parentTraceNodes: 4,
      normalizedMessages: 4,
      exportedMessages: 4,
      userVoiceTranscriptMessages: 1,
      assistantVoiceTranscriptMessages: 1,
    },
  });
  assert.match(html, /语音转录：用户 1 条，AI 1 条/);
});
