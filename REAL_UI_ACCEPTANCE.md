# KV Archive v0.11.2 — Real Extension UI Acceptance

Use this checklist after loading the unpacked extension in a real Chrome profile.

## Installation and preservation

- [ ] Close open KV Archive pages.
- [ ] Replace the files in the same unpacked-extension directory; do not remove the old extension first.
- [ ] Open `chrome://extensions/` and reload KV Archive.
- [ ] Confirm existing backup, library, state, memory, and Obsidian export data still appears.
- [ ] Confirm the displayed extension name and popup title are KV Archive.

## Navigation

- [ ] Popup primary backup action opens the correct page.
- [ ] Popup Library, State, Memory, and Obsidian destinations open correctly.
- [ ] Every side-rail destination works and exactly one destination is active.
- [ ] Back/forward navigation and reopening a page do not produce console errors.

## Core success paths

- [ ] Backup Center detects the logged-in ChatGPT workspace and completes one safe test backup.
- [ ] Local Library can search and open a result.
- [ ] Project State can load an existing project without changing approved state implicitly.
- [ ] Memory Sync can generate a candidate and display its diff without sending automatically.
- [ ] Obsidian Export can analyze a project and produce a volume.

## Failure and recovery

- [ ] No logged-in ChatGPT tab produces a clear recoverable state.
- [ ] Disabled buttons are visually and functionally disabled.
- [ ] A cancelled/paused operation preserves context and can resume where supported.
- [ ] Empty Library/State/Memory/Knowledge screens remain understandable.

## Responsive and accessibility

- [ ] 100%, 125%, 150%, and 200% browser zoom remain usable.
- [ ] Keyboard focus is visible for links, buttons, inputs, selects, and summaries.
- [ ] Enter/Space activates appropriate controls.
- [ ] No essential control is hidden in a short-height window.
- [ ] Light and dark operating-system modes remain legible.
- [ ] Reduced-motion mode does not remove information.

## Completion record

Record browser version, operating system, extension path, date, failures, screenshots, and whether v0.11.1 data remained intact. Only after this checklist passes should the UI be described as real-browser accepted.
