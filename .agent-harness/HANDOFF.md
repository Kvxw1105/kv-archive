# KV Archive Handoff — GitHub / Local Agent Transition

Date: 2026-08-09  
Baseline: v0.16.11  
Mode: HANDOFF → GitHub bootstrap

## Goal

Move KV Archive from ZIP/chat-session development into a durable public GitHub repository with local-Agent implementation, reproducible CI, machine-readable state and explicit acceptance gates.

## What is already true

- The v0.16.11 source baseline existed and had 294/294 local regression PASS, typecheck PASS and 7/7 performance-gate PASS before this governance transition.
- Source had no `.git` metadata.
- The public seed removes generated dist outputs and anonymizes unrelated synthetic example names before the first public history.
- Product north star, master PRD, acceptance standards, roadmap, governance, public-repo policy and Agent prompts are included in this seed.

## What must happen next

TASK-030 must create the public repository without silently changing product behavior. It must re-run the baseline tests after the public-seed sanitization, perform a privacy/secret preflight, create the first commit, push, confirm CI and report the exact repository URL/head SHA.

## Protection

- Do not publish owner data or browser databases.
- Do not auto-add a project license.
- Do not implement new product features during repository bootstrap.
- Do not rewrite existing runtime contracts merely to make the repository look cleaner.
- Preserve third-party notices/licenses.

## Seven-level state at handoff

- EDITED: repo-ready seed/docs prepared.
- LOCALLY_VERIFIED: prepared GitHub seed passed npm ci, typecheck, 294/294 tests and all seven performance gates. Bootstrap Agent must repeat the pre-push/remote verification.
- COMMITTED: no.
- PUSHED: no.
- PR_UPDATED: no.
- CI_PASSED: no.
- RELEASED: no.

## Start instruction

Read `LOCAL_AGENT_START_HERE.md`, then execute `.agent-harness/prompts/00_BOOTSTRAP_PUBLIC_GITHUB.md` exactly as a bounded bootstrap task.
