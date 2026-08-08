# Real v0.15.0 Acceptance

Status before execution: `PENDING_EXTERNAL_ACCEPTANCE`.

## Required environment

- one sender environment with a real KV Archive Agent Bundle;
- two separate Agent contexts: sender/controller and receiving Agent;
- a disposable output directory;
- private verification kit kept inaccessible to the receiving Agent.

## Procedure

1. Run `handoff-create` for one real Project.
2. Inspect the receiver ZIP and confirm no unrelated Project or answer-key file is present.
3. Move only the receiver ZIP to the receiving environment.
4. Run `handoff-receive`; confirm no files are extracted when a deliberately modified copy is used.
5. Start a fresh receiving-Agent context with the extracted Bundle, Context Pack and Prompt.
6. Save the Agent's final response to `handoff-response.json`.
7. Return the response and receiver receipt to the sender/controller.
8. Run `handoff-verify` with the untouched receiver ZIP and private kit.
9. Repeat once with an intentionally invented decision or invalid Evidence URI and confirm `VERIFIED_FAIL`.

## Pass criteria

- receiver preflight status is `PASS`;
- only the selected Project is visible;
- approved State is unchanged;
- valid response reaches the expected Benchmark threshold with no critical issue;
- invented facts fail;
- all receipts persist and are not overwritten;
- no claim of authenticated signer identity is shown.
