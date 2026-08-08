# KV Archive Master Acceptance Standard

Date: 2026-08-09  
Purpose: define product-level gates that are stronger than “the code builds” or “a button exists”.

## Gate A — Evidence and data integrity

A1. Current-conversation capture preserves the source conversation graph, active branch and supported visible content without silent truncation.  
A2. Every backup/export reports COMPLETE / PARTIAL / FAILED truthfully.  
A3. Unknown nodes, unsupported asset types and failed downloads remain observable in diagnostics.  
A4. Supported legacy archive, Evidence URI, Portable Capture and Agent Bundle formats remain readable or have an explicit tested migration.  
A5. Destructive actions identify their exact scope and never delete Raw Evidence through an “index cleanup” or similarly ambiguous operation.  
A6. Snapshot retention and garbage collection cannot delete content still referenced transitively by a retained snapshot.

**Acceptance evidence:** deterministic fixtures + regression tests + at least one owner-profile real-data run.

## Gate B — Incremental backup and recovery

B1. A previously archived conversation that receives new messages is detected as updated.  
B2. Unchanged conversation nodes are physically reused after the conversation has entered the chunked storage format.  
B3. Interrupted long jobs save checkpoints and can resume without starting over.  
B4. A missed scheduled run is caught up after Chrome starts again.  
B5. One failed attachment cannot invalidate already completed conversation backup work.  
B6. Retention limits and GC preserve the ability to reconstruct every retained logical snapshot.

**Current synthetic performance reference:** the v0.16.11 10,000-node continuation smoke reuses 9,999 prior node objects. Real owner-profile acceptance is still required.

## Gate C — Large-library retrieval and scope correctness

C1. Search has no undocumented fixed result cap that silently hides relevant records.  
C2. Project-scoped export reads only the target Project when an existing key/index can bound the operation.  
C3. Large libraries avoid whole-store reads in hot paths when bounded paging/indexed reads are available.  
C4. Project identity collisions are explicit; similarly named Projects cannot silently merge.  
C5. Note-only Projects remain usable across Project State, Context, Obsidian and Agent workflows.

## Gate D — User-facing task truthfulness

D1. Any operation that may take perceptible time provides visible progress, running state or deterministic immediate feedback.  
D2. Pause preserves completed work where the underlying task supports pause/resume.  
D3. Errors include an actionable recovery path when one exists.  
D4. Refreshing/reopening a page does not reset durable task progress to a misleading initial state.  
D5. Light, dark and system appearance modes keep readable contrast for primary text, controls, disabled states and status messages.  
D6. No major control may exist as a cosmetic shell with no functioning data path behind it.

## Gate E — Notes and mobile daily usability

E1. A user can open the Notes surface and start typing immediately with local persistence.  
E2. Notes, web clips, conversation clips and files share a stable content contract while preserving source differences.  
E3. Tags and Project assignment are optional at capture time.  
E4. Editing creates recoverable versions; delete/recycle behavior is explicit.  
E5. Search and Project views work offline for locally available content.  
E6. Mobile share/capture should require minimal interaction and must not secretly ingest clipboard or unrelated application data.  
E7. The separately developed note-app prototype must integrate through Repository/Adapter contracts; its UX investment must not be discarded by a brute-force frontend merge.

## Gate F — Agent continuity

F1. Context Pack generation is deterministic for the same repository state, policy and token budget.  
F2. Memory Gate returns INCLUDE / EXCLUDE / REVIEW with machine-readable reasons.  
F3. Approved Project State and Memory remain immutable except through governed versioned workflows.  
F4. External Agent access is read-only unless it produces an explicit proposal artifact.  
F5. Continuity Benchmark keeps its current rule: PASS requires at least 85/100 and no critical identity/evidence errors.  
F6. Verified Handoff requires package integrity, matching receipts/state identity and a Continuity Benchmark PASS.

## Gate G — Privacy and security

G1. No authentication token, cookie, signed temporary URL, private key or real private conversation fixture is committed to the public repository.  
G2. Remote AI/semantic processing requires explicit user enablement.  
G3. Public logs, bug reports and diagnostic bundles must support redaction.  
G4. PWA storage/cache cleanup remains inside the KV Archive namespace.  
G5. Public repository publication must pass a secret/private-data preflight before the first push.

## Gate H — Engineering and public-repo maintainability

H1. A clean checkout can install dependencies, build, typecheck and run the deterministic regression suite from documented commands.  
H2. Main-branch changes go through a scoped branch/PR after the initial baseline import.  
H3. CI status is tied to the exact commit being reviewed.  
H4. Runtime changes, local verification, commit, push, PR, CI and release are reported as separate completion levels.  
H5. AGENTS.md holds stable invariants; `.agent-harness/` holds changing state, task cards and handoffs.  
H6. Every meaningful milestone ends with updated state, evidence, unresolved risk and next actions.

## v1.0 readiness rule

KV Archive should not call itself stable v1.0 until Gates A–H have real-environment evidence for the primary Chrome/desktop path, the critical recovery paths have been exercised, and the repository has repeatable CI/release governance. Features beyond the core continuity loop may remain beta if clearly labeled.
