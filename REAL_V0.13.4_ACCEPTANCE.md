# KV Archive v0.13.4 Real Browser Acceptance

Do not delete the original ChatGPT conversation until this checklist passes.

## A. Safe upgrade

1. Keep the unpacked v0.13.3 folder as rollback.
2. Preserve irreplaceable KV Archive local data.
3. Extract v0.13.4 to a new directory and load it as an unpacked extension.
4. Confirm Library, Basket and existing backup tasks remain visible.

## B. Original failing conversation

Use the conversation that previously produced only the last user/assistant pair.

1. Open it at the bottom without manually scrolling upward.
2. Export `精简对话`.
3. Observe the page:
   - a confidently complete structured source may export without scrolling;
   - otherwise a KV Archive progress panel should appear and the conversation body—not the left sidebar—should repeatedly move upward;
   - the page should return near the original reading position afterward.
4. Open the HTML and verify the first, middle and final turns.
5. Verify Skill calls, search parameters, tool results and truncated JSON remain absent.

## C. Read capture diagnostics

Open `导出诊断（A → D）` and record:

- A raw source nodes / accumulated DOM messages;
- B traced branch / hydrated messages;
- C normalized active-path messages;
- D final exported compact messages;
- capture adapter;
- selected source;
- source completeness;
- hydration outcome;
- hydration iterations;
- page lower bound;
- confidence reason codes.

Expected interpretation:

- `hydrationOutcome = complete` only after the top remains stable;
- `time-limit`, `step-limit` or `stalled` must remain `可能不完整`;
- A/B remaining 2 means acquisition still failed;
- A/B large but C=2 means normalization/path construction failed;
- C large but D=2 means semantic filtering failed;
- aligned A/B/C/D plus present first and last turns is the intended pass.

## D. Scroller correctness

During fallback hydration:

- the main conversation column should move;
- the left history sidebar should not be the primary moving container;
- the progress count should not increase merely because the same viewport content changed position;
- after completion, the page should return near its prior distance from the bottom.

## E. Adversarial cases

Test at least one of each:

- a genuine one-turn conversation;
- a 50+ turn conversation;
- Project/GPT nested URL containing `/c/{id}`;
- identical short text in two different turns;
- a tool-heavy conversation in compact mode;
- throttled network or a manual interruption during upward loading.

A genuine short conversation may be corroborated by a quick completed hydration pass. A bounded interruption must never display verified completeness.

## F. Acceptance record

Record:

- extension version;
- redacted URL shape;
- A/B/C/D counts;
- selected adapter/source;
- hydration outcome and iterations;
- first and last prompt present: yes/no;
- duplicate or missing messages;
- original scroll position approximately restored: yes/no;
- final pass/fail.
