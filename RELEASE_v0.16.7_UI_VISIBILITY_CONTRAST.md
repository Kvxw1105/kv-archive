# KV Archive v0.16.7 — UI Visibility & Contrast Hardening

Status: `LOCALLY_VERIFIED`
Date: 2026-08-06

## Why this release exists

v0.16.6 introduced adaptive light, dark and system themes, but real use exposed a second-layer problem: several page-specific rules still used 8–10 px functional text, a late global button rule overrode local card controls, some Capture Center theme aliases were undefined, and a few light/dark button pairs did not preserve readable foreground/background contrast.

v0.16.7 is a page-by-page visibility correction, not another palette replacement.

## Delivered

- Added a final visibility layer after page and theme styles on all extension surfaces and Notes PWA.
- Defined missing Capture Center semantic aliases: `--kv-surface`, `--kv-elevated`, and `--kv-border`.
- Split primary, secondary, ghost, danger and disabled control foreground/background pairs.
- Prevented card-like controls, close buttons, list actions and navigation controls from inheriting primary-button colors.
- Raised functional body and control type, with a 12 px floor for interactive microcopy.
- Corrected popup brand, task guidance, destinations, quick actions and status readability.
- Corrected Backup Health, scheduler summaries, metric labels and section identifiers.
- Corrected Project Context and Memory Gate labels, chips, receipts, tables and editor gutter.
- Corrected Obsidian project labels, quality badge and dark output-tree text.
- Preserved native `hidden` semantics so recovery/action containers cannot render as blank buttons.
- Split Notes PWA accent text from white-on-color button surfaces, fixing the dark floating action button.

## Browser evidence

A real Chromium engine rendered static inlined builds of:

- popup;
- Backup Center;
- Conversation Basket;
- Local Library;
- Capture Center;
- Project State;
- Project Context / Memory Gate;
- Obsidian Graph;
- Notes PWA.

Extension pages were checked in both light and dark modes. Visible functional text was checked for a minimum 11 px floor, while interactive microcopy and controls were checked at a 12 px floor. Normal, hover and focus control states were checked for WCAG AA 4.5:1 text contrast.

Final browser-audit result:

- 16 extension page/theme renders: 0 text-size or contrast findings;
- normal/hover/focus control-state audit: 0 findings;
- 2 Notes PWA theme renders: 0 findings.

This browser evidence uses inlined static pages because the container cannot expose a stable loaded-extension URL or the owner's Chrome profile. It does not replace real installed-extension acceptance.

## Compatibility

- No IndexedDB migration.
- No archive, snapshot, Memory Gate, recovery or Agent Bundle contract change.
- No capture or export algorithm change.
- v0.16.6 theme choices remain compatible.
