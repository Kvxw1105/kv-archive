# KV Archive v0.13.4｜Capture Hardening

## Why this release exists

v0.13.3 added nested ChatGPT route recognition and visible upward history hydration. A second adversarial review found several cases where the implementation could still look successful while remaining unreliable in a real long conversation:

- a very small structured tree can be internally continuous but still represent only the latest response package;
- a generic scrollable ancestor can be the sidebar or an outer page container rather than the conversation body;
- virtualized windows without stable role attributes can flip user/assistant parity when inferred viewport by viewport;
- reaching a step or time limit could be confused with a completed top-of-history pass;
- growth detection could treat the same role-less message at a new viewport index as new content;
- scroll restoration and hydration diagnostics were not explicit enough for real acceptance.

v0.13.4 hardens the capture decision, the DOM recovery loop and the evidence exposed after export. It does not claim that the user's private failing conversation has already passed real-browser acceptance.

## Changed behavior

### Structured capture now requires confidence, not only graph continuity

A candidate Conversation is assessed against both its own graph and the currently rendered page. The confidence gate checks:

- matching conversation identity;
- a continuous current-leaf-to-root parent chain;
- no parent cycles;
- no fewer messages than the current visible window;
- no branch shorter than the page's observable turn-number lower bound;
- a plausible current leaf;
- corroboration for small branches.

A small two-node tree can no longer become `verified` merely because its user node has no parent. It must either be independently convincing or be corroborated by a completed page-history hydration pass.

### Conversation scroller selection is evidence-based

The hydrator scores scrollable ancestors using:

- how many rendered message elements they contain;
- ancestor distance from those messages;
- main-content semantic hints;
- available scroll range;
- strong penalties for navigation and sidebar containers.

The chosen scroller stays locked unless it becomes disconnected or no longer contains the conversation messages. Scroller switches are recorded in diagnostics.

### Hydration completion has explicit outcomes

The history pass now records one of:

- `complete` — top reached and remained stable for the required rounds;
- `time-limit` — bounded duration expired;
- `step-limit` — bounded iteration count was exhausted;
- `stalled` — the container stopped moving before reaching the top;
- `not-requested`.

Only `complete` sets `hydrationComplete: true`. Every other outcome remains partial and receives a warning.

### Virtualized windows are merged before role parity is inferred

Unknown roles are kept unknown while overlapping DOM windows are merged. User/assistant fallback parity is applied once, after the complete ordered sequence has been reconstructed. This prevents a viewport that begins on an assistant message from shifting every later role.

Stable message IDs remain the primary deduplication key. Repeated text from different stable turns is preserved. Growth detection uses a separate position-insensitive observation key so movement within virtualization does not create false progress.

### Scroll position restoration preserves reading context

The hydrator records the user's initial distance from the bottom and restores the equivalent position using the final scroll height and viewport height. This is more reliable when lazy loading changes both the document height and the visible viewport.

### User-visible progress and richer diagnostics

When DOM hydration is required, a small status overlay reports observed messages and the current step. The exported A→D diagnostic panel now includes:

- selected capture source;
- source completeness;
- hydration outcome;
- completed/not-completed state;
- hydration iterations;
- page-derived lower bound;
- structured-confidence reason codes.

### Export detail corrections

- Current export performs exactly one file download per requested artifact.
- Hydration iteration diagnostics use the same field name from capture through renderer.

## Compatibility

- Canonical Schema remains v0.2.
- v0.13.1 Conversation Basket and provider foundation remain intact.
- v0.13.2 semantic compact filtering and stream coalescing remain intact.
- v0.13.3 nested route recognition and DOM history accumulation remain intact.
- Existing historical backup, snapshots, Agent Bridge, Continuity Benchmark, Project State, Memory and Obsidian paths remain covered by regression tests.

## Status

`LOCALLY_VERIFIED`.

The exact original private long conversation must still be re-exported in the user's logged-in browser. Do not delete source conversations or treat DOM fallback as a unique verified backup before that acceptance passes.
