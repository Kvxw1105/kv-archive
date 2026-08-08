# Real Chrome Acceptance — v0.16.5

Use an authenticated Chrome profile and verify representative workflows.

## Immediate acknowledgement

1. Click a long action such as catalog refresh, incremental run, Library import or Obsidian analysis.
2. Confirm the button immediately enters a busy state.
3. Confirm the task dock becomes visible without hunting for it.
4. When the relevant panel is offscreen, confirm the page scrolls to it without losing the current task.

## Honest progress

1. For countable work, confirm the displayed count and percentage advance with actual items.
2. For unknown-duration work, confirm the UI says it is running and does not invent a percentage.
3. Confirm elapsed time updates.
4. Confirm ETA appears only after enough measurable progress exists.

## Pause, failure and recovery

1. Pause a large Basket or Obsidian export.
2. Confirm the displayed percentage remains at the completed portion rather than jumping to 100%.
3. Trigger a safe failure, such as no ChatGPT tab or an invalid Portable Capture file.
4. Confirm the dock explains the failure and the existing partial data remains available.
5. Confirm the original action button becomes usable again when business rules allow it.

## Mobile and accessibility

1. Test approximately 390 × 844 and a desktop viewport.
2. Confirm the mobile task dock does not cover the primary action area.
3. Enable reduced motion in the operating system and confirm pulsing/scanning/spinning animation is removed while text feedback remains.

## Required evidence

Record Chrome version, extension version, workflow, start/end state, screenshot or short recording, and any console error. This release remains `LOCALLY_VERIFIED` until these checks pass in a real user profile.
