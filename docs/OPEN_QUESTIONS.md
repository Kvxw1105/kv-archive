# Open Product / Architecture Decisions

These items must not be silently decided by a coding Agent.

1. **Project license:** public source is approved; an open-source license has not been selected.
2. **Desktop technology:** evaluate only when Desktop becomes an active milestone; do not prematurely lock Electron/Tauri/native.
3. **Sync topology:** LAN/local-first remains preferred; cloud/server sync is optional and requires explicit privacy/security design.
4. **Separate note-app prototype:** its UI/interaction investment must be audited before integration. Integration should use Repository/Adapter boundaries.
5. **Cloud service / account model:** not required for the local-first core and should not become a prerequisite without owner approval.
6. **Semantic AI provider policy:** deterministic core remains default. Model use, embeddings and remote semantic processing require explicit opt-in and cost/privacy accounting.
7. **Public roadmap promises:** repository issues may describe plans, but dates should not be promised without evidence and owner approval.
