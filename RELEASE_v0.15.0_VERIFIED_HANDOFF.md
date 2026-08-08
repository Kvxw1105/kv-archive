# KV Archive v0.15.0 — Verified Handoff v1

v0.15.0 converts the existing continuity components into a governed project-transfer transaction.

## Sender package

`handoff-create` builds a receiver ZIP containing only the selected Project, its approved read-only Project State, a Project-scoped Agent Bundle v3, a token-bounded Context Pack, Memory Gate manifest/report, a public Continuity Benchmark challenge and a sender receipt.

A separate private verification kit contains the Benchmark answer key and the expected receiver-package SHA-256. It must not be shown to the receiving Agent.

## Receiver preflight

`handoff-receive` performs validation before extraction:

- ZIP structure, CRC/path safety and declared entries;
- per-entry SHA-256 and payload-root identity;
- source/scoped Bundle and sender-receipt cross-links;
- exactly one Project throughout embedded data;
- approved State version/hash identity;
- Context Pack bundle identity and token budget;
- Memory Gate and Benchmark identity;
- rejection of unexpected files and private answer keys.

Passing preflight writes an append-only local receipt and materializes the read-only receiving workspace.

## Post-run verification

`handoff-verify` requires the receiver package, private kit, receiver receipt and returned response. It evaluates continuity against the private answer key and emits `VERIFIED_PASS`, `VERIFIED_FAIL` or `BLOCKED`, plus a completion receipt and failure taxonomy.

## Trust boundary

SHA-256 detects package changes. Receipts are append-only under the tool workflow and explicitly marked `self_attested_local_receipt`; v1 does not provide cryptographic signer authentication.
