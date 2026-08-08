# Prompt Template — Continue KV Archive Development

Read AGENTS.md, CURRENT_STATE, HANDOFF and the active task card first. Verify Git branch/status and current head SHA before editing.

Current objective: <one observable target>  
Protected contracts/data: <list>  
Acceptance: <tests/real behavior>  
Allowed scope: <files/modules>  
Explicit non-goals: <list>

Workflow: inspect real call chain → reproduce/confirm gap → implement smallest complete slice → targeted verification → inspect diff → wider regression → adversarial review → update state/handoff → commit/push/PR/CI evidence.

Never report “done” without separating EDITED / LOCALLY_VERIFIED / COMMITTED / PUSHED / PR_UPDATED / CI_PASSED / RELEASED.
