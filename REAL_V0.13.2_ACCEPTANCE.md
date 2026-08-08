# KV Archive v0.13.2 Real Browser Acceptance

Do not delete any original conversation based only on local automated tests. Complete this checklist in a real Chrome profile first.

## A. Upgrade safety

1. Keep the existing v0.13.1 unpacked extension folder as rollback.
2. Export or back up any irreplaceable KV Archive local data.
3. Load the unpacked v0.13.2 extension and confirm existing Library, Basket selections and backup tasks remain visible.

## B. Original defect conversation

Use the original ChatGPT conversation that previously produced `睡不着的时候和GPT聊的天0728.htm`.

1. Leave the page at the bottom; do not scroll to the top.
2. Export `精简对话` as HTML.
3. Confirm the first historical user prompt and the last prompt are both present.
4. Compare the number of user prompts in ChatGPT with the HTML directory count.
5. Confirm these strings or equivalents do not appear as normal replies:
   - `{"paths":["skills`
   - `{"uri":"skills://`
   - `system1_search_query`
6. Confirm the label is `完整性：已验证完整` only if all current-branch prompts and final answers are present.
7. Save the generated integrity report before considering any cleanup of the original conversation.

## C. Fifty-turn long conversation

1. Open a conversation containing at least 50 user/assistant turns.
2. Leave the page at the bottom without manually loading older DOM content.
3. Export compact HTML.
4. Verify first, middle and last turns.
5. Verify order, no duplicates and no missing current-branch turns.

## D. Tool-chain conversation

Use a conversation containing Skill calls, web search, file reading and at least one failed tool operation.

Compact mode must contain only:

- actual user messages;
- final user-facing assistant answers;
- user-visible attachment information embedded in those messages.

Technical mode must:

- label technical events correctly;
- keep them collapsed by default;
- avoid presenting tool parameters as normal ChatGPT answers;
- avoid isolated/truncated streaming fragments.

## E. Branches

With a conversation containing edited prompts or regenerated answers:

1. Confirm current-branch export follows the selected leaf back to the root.
2. Confirm current-branch ordering is correct.
3. Confirm historical branch nodes remain preserved in technical/raw evidence.
4. Confirm branch content is not mixed into the active reading view.

## F. Failure and downgrade behavior

Temporarily reproduce a condition where the authoritative conversation request fails, if safe to do so.

- Export must not display `已验证完整` unless the fallback proves an authoritative, continuous conversation response.
- Partial or uncertain capture must display `可能不完整` or fail explicitly.

## Acceptance record

Record:

- extension version;
- conversation ID or a redacted stable reference;
- raw node count;
- current branch count;
- user count;
- final assistant count;
- filtered technical count;
- integrity status;
- pass/fail and any screenshots without private content.
