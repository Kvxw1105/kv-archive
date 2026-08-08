# KV Archive v0.13.5 Real Browser Acceptance

## Safety

- Keep the unpacked v0.13.4 folder as rollback.
- Load v0.13.5 from a new directory.
- Do not delete the source ChatGPT conversation.
- Do not treat a partial DOM fallback as the only verified backup.

## Primary test conversation

Use the exact conversation that contains:

- many gray ChatGPT Voice / Live transcript turns;
- both user and assistant Voice turns;
- at least one ordinary text-mode user/assistant exchange at the end;
- enough history to require structured capture or upward hydration.

## Procedure

1. Open the conversation at its normal direct, Project or GPT route.
2. Stay near the bottom; do not manually preload the entire history.
3. Export in `精简对话` mode.
4. Observe whether KV Archive uses structured capture or visibly hydrates upward.
5. Open the exported HTML and inspect the A→D diagnostic panel.
6. Record:
   - A raw nodes;
   - B active-path / accumulated nodes;
   - C normalized messages;
   - D exported messages;
   - selected capture source;
   - hydration outcome and iterations;
   - user Voice transcript count;
   - assistant Voice transcript count;
   - source completeness and confidence reasons.
7. Verify one early Voice user turn, one middle Voice assistant turn and the final ordinary text exchange.
8. Search the HTML for a distinctive phrase from a gray Voice transcript.
9. Search for technical strings such as signed audio URLs, audio asset IDs, `system1_search_query`, `skills://` and tool payload fragments.
10. Export the same conversation in technical mode and confirm Voice turns are labelled `语音转录`.

## Pass criteria

### Compact export

- All expected Voice user transcripts are present as user messages.
- All expected Voice assistant transcripts are present as final assistant messages.
- Ordinary text-mode messages remain present and ordered correctly.
- Tool, Skill, search, reasoning and commentary events remain excluded.
- Audio URLs, asset IDs and raw audio metadata do not appear in readable message bodies.
- The first, middle and final conversation regions are represented.
- Directory and message counts match the final rendered articles.

### Technical export

- Voice transcript text remains readable.
- Voice transcript turns carry a `语音转录` marker.
- Technical evidence remains categorized and folded rather than impersonating normal assistant prose.

### Integrity

- `COMPLETE` is shown only if the structured branch is verified and continuous.
- A partial or heuristic DOM result remains `可能不完整` or `未验证`.
- Voice transcript counters are non-zero when gray Voice turns are present.

## Failure triage

- A/B small: history acquisition or hydration still failed.
- A/B large, Voice counts zero: ChatGPT exposed an unrecognized transcript payload or DOM shape.
- Voice counts non-zero, C small: normalization/active-path construction failed.
- C large, D small: export filtering failed.
- Transcript text present but audio metadata leaks: readable/evidence layer separation failed.

For a failed case, preserve a redacted fixture containing field names, content types, role, transcript shape and DOM attributes. Never include cookies, authorization headers, account identifiers, signed media URLs or unrelated private conversation text.

## Release decision

Only after this checklist passes may the original P1 be marked `FIXED_VERIFIED` for Voice/Live transcript conversations.
