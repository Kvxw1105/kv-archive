# KV Archive v0.16.5 — Unified Task Feedback & Progress UX

State: `LOCALLY_VERIFIED`

## Problem addressed

Long operations previously exposed inconsistent feedback. Some buttons changed only a status sentence, some progress regions were below the current viewport, and several indeterminate operations gave no immediate acknowledgement. Users could not reliably tell whether a click was accepted, what stage was running, whether partial work was safe, or where the result went.

## Implemented

- Added one shared task feedback controller and visual system for extension pages.
- Clicking a long-running action now immediately reveals and, when needed, scrolls to a persistent task dock.
- Supports determinate progress from real counts and explicit indeterminate progress when a percentage cannot be honestly calculated.
- Shows elapsed time and derives an ETA only after measurable throughput exists.
- Uses four named stages per workflow rather than a generic spinner.
- Busy buttons acknowledge the click and prevent accidental duplicate execution.
- Success, pause and failure preserve the real partial progress and explain the next action.
- Mobile layout moves the dock above the safe area and adds bottom space so it does not cover page actions.
- `prefers-reduced-motion` disables nonessential animation.

## Covered workflows

- Current-conversation save/export.
- Full and incremental backup, ten-minute acceptance, pause and local archive generation.
- Basket catalog refresh, selected-conversation capture, partial export and pause.
- Local Library import, clear and Agent Bundle export.
- Portable Capture export, dry run, apply, rollback and promotion.
- Project Context generation, ChatGPT insertion, approval and Memory Gate.
- Project State proposal import, approve, reject, refresh and rollback.
- Obsidian analysis, multi-volume export and pause.

## Compatibility

No IndexedDB migration, archive format change, evidence rewrite or Project State mutation was introduced. The release changes task feedback and page interaction only.
