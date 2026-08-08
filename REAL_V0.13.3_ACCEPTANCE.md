# KV Archive v0.13.3 Real Browser Acceptance

Do not delete the original ChatGPT conversation until this checklist passes.

## A. Upgrade safety

1. Keep the unpacked v0.13.2 extension directory as rollback.
2. Preserve irreplaceable KV Archive local data.
3. Load v0.13.3 as an unpacked extension.
4. Confirm Library, Basket and backup tasks remain visible.

## B. Confirm route classification

Open the original long conversation and inspect the address bar.

- The URL may be a direct `/c/{id}` path or a nested Project/GPT path containing `/c/{id}`.
- Open the popup.
- It must say the current ChatGPT conversation supports structured high-fidelity capture.
- It must not describe the page as ordinary visible-only capture merely because the path has a prefix.

## C. Original defect conversation

Use the conversation that previously generated `睡不着的时候和GPT聊的天0728.htm`.

1. Leave the conversation at the bottom.
2. Select `精简对话` and export HTML.
3. If structured capture succeeds, the page may not scroll.
4. If structured capture is uncertain, the page should visibly continue moving upward until older history stops loading, then return near the original position.
5. Confirm the first, middle and final historical turns are present.
6. Confirm the directory count matches the current branch's user prompts.
7. Confirm Skill calls, search parameters and truncated JSON are absent.

## D. Read A-to-D diagnostics

Open the collapsed `导出诊断（A → D）` section.

Record:

- A: raw source nodes / accumulated DOM messages;
- B: parent-chain / hydrated page messages;
- C: normalized active-path messages;
- D: exported compact messages;
- capture adapter;
- completeness label.

Interpretation:

- A or B remains 2: capture/hydration still failed;
- A/B large but C is 2: normalization or path construction failed;
- C large but D is 2: semantic filtering failed;
- A, B, C and D align with the expected branch: pass.

For compact mode D should equal the number of real user prompts plus final assistant answers, after any stable stream fragments are merged.

## E. Virtualized long conversation

Use a conversation containing at least 50 user/assistant turns.

1. Stay at the bottom.
2. Export without manually scrolling upward first.
3. Verify early, middle and late turns.
4. Verify order and absence of duplicates.
5. Include two different turns with identical short text if possible; both must survive.

## F. Failure behavior

If only DOM hydration succeeds:

- completeness must remain `可能不完整`;
- the diagnostic adapter should identify DOM history hydration;
- the export must still prefer the larger accumulated branch over a two-message uncertain structured candidate.

## Acceptance record

Record:

- extension version;
- redacted URL shape (`/c/…` or `/…/c/…`);
- A/B/C/D counts;
- adapter;
- integrity status;
- first and last prompt present: yes/no;
- duplicates or omissions;
- pass/fail.
