# KV Archive v0.14.1 Real Acceptance

Do not delete original conversations or old extension folders before these checks pass.

## Browser extension upgrade

1. Keep the previous unpacked extension folder.
2. Load v0.14.1 from a new folder.
3. Open Memory Center and confirm existing approved Memory versions still appear.
4. Confirm Project State, Library and Basket records remain present after IndexedDB upgrade 9 → 10.

## Memory Gate UI

1. Select a Project with approved status, decisions and tasks.
2. Run balanced/internal Gate at 2K.
3. Confirm each row shows decision, reason/warning, evidence count and Token count.
4. Switch to external target and confirm restricted items are excluded and internal items require review unless broad policy is selected.
5. Confirm running Gate does not change Project State version/hash.
6. Export the receipt and inspect all seven files.
7. Change policy, restore a prior receipt policy, and confirm a new config version is created.

## Paired benchmark

1. Export a current Agent Bundle.
2. Run `create-gate-benchmark.cmd` or `.sh`.
3. Keep the answer key private.
4. Use two fresh receiving-Agent sessions: one with Gate-off pack, one with Gate-on pack.
5. Save JSON responses without editing after viewing the key.
6. Run `score-gate-benchmark.cmd` or `.sh`.
7. Record total delta, dimension deltas, taxonomy and any regression.

A positive result for one project/model does not establish a universal default. Any regression must remain documented.
