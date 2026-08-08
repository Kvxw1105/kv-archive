# KV Archive Key Decisions

## D-001 — GitHub becomes engineering source of truth

Date: 2026-08-09  
Decision: after the v0.16.11 transition baseline, durable code/state history moves to GitHub and local Agent workflows. ChatGPT remains strategy/review/handoff support.

## D-002 — Browser Extension remains a capture adapter

Long-term storage/background/sync responsibilities should progressively move to a durable local runtime. Browser code should not be expanded simply because it is the current implementation surface.

## D-003 — Separate note-app prototype is an asset

Do not discard or brute-force merge it. Freeze and audit its UX, then connect it to KV Archive through Repository/Adapter contracts.

## D-004 — Public visibility does not choose a license

Repository may be public. No project-level open-source license is selected yet. Third-party license obligations remain preserved.

## D-005 — Deterministic truth layer remains authoritative

Semantic AI may advise, classify or propose, but evidence identity, approved state, version history, gate rules, receipts and final persistence remain deterministic/governed.
