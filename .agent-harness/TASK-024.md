# TASK-024 — Verified Handoff v1

Status: `COMPLETED_LOCALLY`
Version: `0.15.0`

## Goal

Turn Project State, Memory Gate, Context Pack, Agent Bundle and Continuity Benchmark into one deterministic sender/receiver handoff transaction with preflight and post-run verification.

## Protected invariants

- Approved Project State remains read-only.
- Receiver package contains only the selected Project.
- Private Benchmark answer key never enters the receiver package.
- Bundle v1/v2/v3 remain readable.
- No package is extracted before preflight passes.
- Receipts describe SHA-256 integrity and local self-attestation only; they do not claim authenticated signatures.

## Acceptance

- create → receive → verify CLI path completes;
- payload tampering, private-answer-key exposure, scope leakage and receipt mismatches block;
- unsupported facts and invalid Evidence yield `VERIFIED_FAIL`;
- valid response yields `VERIFIED_PASS`;
- existing full suite and performance gates remain green.
