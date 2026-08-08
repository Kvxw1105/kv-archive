# Development Mode Transition — 2026-08-09

## Decision

KV Archive stops using a long ChatGPT web conversation as the primary coding workspace. The v0.16.11 codebase becomes the frozen transition baseline for a GitHub + local-Agent workflow.

## Why

The web-session approach produced substantial working software, yet repeated ZIP transfer, manual browser replacement, missing Git history, scattered state and long-context handoffs create avoidable maintenance friction. The next productivity gain comes from repository discipline and durable Agent context rather than another sequence of browser-chat hotfixes.

## What ChatGPT should do next

- clarify product goals and constraints;
- convert user feedback into testable requirements;
- review plans, diffs, PR summaries and acceptance evidence;
- perform adversarial product/architecture reviews;
- prepare high-quality task cards and handoffs when needed.

## What the local Agent should do next

- own repository edits, builds, tests and Git operations;
- keep branch/commit/PR/CI evidence current;
- run real local-browser/device validation when its environment supports it;
- update `.agent-harness/` after each milestone;
- never depend on hidden chat context for critical project facts.

## Frozen transition baseline

- Version: 0.16.11
- Local regression before transition: 294/294 PASS
- TypeScript: PASS
- Performance gates: 7/7 PASS
- Git history: absent before bootstrap
- Real owner-profile Chrome acceptance: still pending
