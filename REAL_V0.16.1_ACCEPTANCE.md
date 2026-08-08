# Real v0.16.1 Acceptance

1. Keep the previous extension folder as rollback.
2. Unzip v0.16.1 and load the folder from `chrome://extensions` using **Load unpacked**.
3. Open ChatGPT, open KV Archive, enter Conversation Basket and refresh the catalog once.
4. Select several conversations, close the KV Archive tab, then reopen it.
5. Confirm the catalog appears from cache and the selected conversations remain selected.
6. Click Backup, Basket, Local Library, Project State and Project Context repeatedly from the popup.
7. Confirm one KV Archive workspace tab is reused instead of new extension tabs accumulating.
8. In Project Context, confirm one Project auto-selects; with multiple Projects, the previous selection returns after reopening.
9. From Backup, add a completed backup to the library and confirm the same tab transitions to Local Library.
10. Report any loss of selections, empty cache, duplicate workspace tabs or IndexedDB upgrade error.
