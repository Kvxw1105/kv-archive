# Install KV Archive v0.16.11

## Recommended upgrade — preserve existing browser data

1. Export any especially important recovery/archive package you want as an extra safety copy.
2. Close open KV Archive workspace pages.
3. Extract `KV-Archive-v0.16.11-extension-install.zip`.
4. Back up the folder currently loaded by Chrome.
5. Copy the extracted v0.16.11 files over that same loaded folder, keeping the folder path unchanged.
6. Open `chrome://extensions` and click **Reload** on KV Archive.
7. Confirm the extension version is `0.16.11`.
8. Open Local Library, Capture, Project State and Backup Center; confirm existing data is present.
9. Follow `REAL_V0.16.11_ACCEPTANCE.md`, starting with the scheduler UI regression and one legacy conversation read.

Keeping the same unpacked-extension folder normally keeps the same extension ID and extension-local IndexedDB. Do not remove the existing unpacked extension first when you intend to preserve that data.

## Conversation storage compatibility

v0.16.11 does not eagerly rewrite existing whole-conversation content objects. Legacy artifacts remain readable. A legacy conversation enters the new node/chunk storage only after a later changed version is fetched and saved.

## Notes PWA

Serve/extract `KV-Archive-Notes-PWA-v0.16.11.zip` using the same origin/path strategy as the previous PWA. The Notes PWA database remains version 1 and its Service Worker cleanup stays inside the `kv-archive-notes-*` cache namespace.

## Database compatibility

No IndexedDB migration is required:

- Extension database version: 13;
- Notes PWA database version: 1.
