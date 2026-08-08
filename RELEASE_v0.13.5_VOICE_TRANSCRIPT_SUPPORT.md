# KV Archive v0.13.5｜Voice / Live Transcript Support

## Why this release exists

Real-browser testing showed that v0.13.2–v0.13.4 corrected technical-event filtering and hardened long-conversation hydration, but a mixed ChatGPT conversation could still lose most of its history when the missing turns came from Voice / Live mode.

ChatGPT can display completed Voice conversations as transcript text in chat history. Those turns are user-visible conversation content and must not be treated as audio-only technical metadata. The previous model primarily recognized ordinary text content and could therefore load the historical nodes while still classifying Voice / Live transcript content as unknown or empty.

v0.13.5 adds an explicit Voice transcript path from structured capture and DOM fallback through normalization, integrity reporting and HTML rendering.

## Changed behavior

### Canonical semantic types

The canonical message model now distinguishes:

- `user`
- `assistant_final`
- `user_voice_transcript`
- `assistant_voice_transcript`

Compact export treats all four as readable conversation content. Technical export keeps the same text and adds a small `语音转录` source badge.

### Structured transcript extraction

The normalizer can extract transcript text from common provider payload shapes, including:

- `transcript` / `transcription`;
- `audio_transcript` / `audioTranscript`;
- `voice_transcript` / `voiceTranscript`;
- `spoken_text` / `spokenText`;
- nested transcript-bearing `parts`;
- Voice, audio, realtime and speech content or metadata signals.

Snake-case and camelCase variants are supported. Transcript text is converted into ordinary canonical text parts. Raw provider metadata remains available only as evidence and is not emitted into compact HTML.

### DOM fallback coverage

The visible-page adapter no longer stops after the first selector family finds ordinary messages. It unions ordinary and Voice/transcript candidate selectors, normalizes candidates to their containing message element, and detects Voice markers from attributes, accessibility labels, icons and media descendants.

Transcript-specific text descendants are preferred. Buttons, scripts, styles, audio and video elements are excluded from fallback text extraction so controls, asset IDs and signed media URLs do not become conversation prose.

### Compact and technical export

Compact mode:

- keeps user text, final assistant text and both Voice transcript types;
- hides audio URLs, audio asset IDs and provider-internal metadata;
- continues excluding tool calls, tool results, reasoning, commentary, system and developer events.

Technical mode:

- keeps the readable transcript;
- labels it as `语音转录`;
- preserves raw evidence through the archive layer rather than mixing it into the readable body.

### Integrity and A→D diagnostics

Integrity counts Voice transcripts as real user and final assistant messages. The export diagnostic panel now separately reports:

- user Voice transcript count;
- assistant Voice transcript count.

This helps distinguish three failure classes:

- A/B large and Voice count zero: capture source or transcript-field recognition failed;
- Voice count non-zero but C/D too small: semantic filtering or rendering failed;
- A/B themselves small: history acquisition or hydration failed before Voice normalization.

### Stream and empty-audio handling

Voice transcript fragments sharing a stable stream identity are coalesced before rendering. A message containing only an audio asset or media pointer, with no transcript text, is not fabricated into a readable conversation turn.

## Compatibility

- Canonical Schema remains v0.2.
- v0.13.1 Provider Foundation and Conversation Basket remain intact.
- v0.13.2 semantic compact filtering remains intact.
- v0.13.3 long-conversation hydration remains intact.
- v0.13.4 capture-confidence and hydration-outcome hardening remain intact.
- Existing backup, snapshots, Project State, Memory, Agent Bridge, Continuity Benchmark and Obsidian paths remain under regression coverage.

## Status

`LOCALLY_VERIFIED`.

The exact private mixed Voice/Live and ordinary-text conversation has not been re-exported in this environment. ChatGPT may expose transcript payloads or DOM markers that differ from the current evidence-driven variants. Real-browser acceptance is required before the original P1 can be marked `FIXED_VERIFIED`.

This release adds transcript preservation. It does not claim that original audio files are downloaded or playable in every export.
