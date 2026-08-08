# Prompt — Separate Note App Integration Discovery

Execute TASK-032 after the owner provides or identifies the separate note-app prototype.

Goal: protect the prototype's existing UI/UX investment and design a narrow Repository/Adapter bridge into KV Archive. Do not start by merging folders.

1. Inspect both repositories/worktrees, Git state and instructions.
2. Inventory the prototype's routes/components/editor/state/storage/search/project/version behaviors.
3. Inventory KV Archive's content-contract, Capture repository, Project, version/recovery/search and PWA data interfaces.
4. Produce a parity/gap matrix and identify which side should own each responsibility.
5. Define a UI-facing Repository interface with no browser-specific storage details leaking into components.
6. Define adapters for the existing KV Archive stores/contracts.
7. Choose one vertical slice that can be implemented and browser-tested without redesigning the whole app.
8. Present the plan and acceptance before large code movement.

Hard constraint: preserve Raw Evidence, versions, recovery, Project identity and Agent contracts. The prototype UI shell is replaceable only with explicit owner approval.
